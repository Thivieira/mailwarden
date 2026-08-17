import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authService } from "../../services/auth";
import { providerOAuthService, type ProviderMode } from "../../services/provider-oauth";
import { syncService } from "../../services/sync";
import { encryptionService } from "../../services/encryption";
import { auditService } from "../../services/audit";
import { db, schema } from "../../db";
import { config } from "../../config";
import { readBody, withPrincipal, type Env } from "../context";
import { renderPage } from "../../ui/render";
import { CallbackPage } from "../../ui/pages.gen.js";
import { AuthenticationError, ConfigurationError } from "../../utils/errors";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Renders the provider-connect outcome. Returns a real Response so the Content-Type
 * survives; the previous framework dropped a route-set header on string returns.
 */
function callbackPage(
  headline: string,
  detail: string,
  facts: { term: string; value: string }[],
  granted: boolean,
  status = 200
) {
  return renderPage(
    headline,
    () => CallbackPage({ host: hostOf(config.APP_BASE_URL), granted, headline, detail, facts }),
    status
  );
}

const ownerScopes = [
  "mail.read", "mail.search", "mail.modify", "mail.archive", "mail.draft", "mail.send",
  "accounts.read", "accounts.manage", "profile.read", "profile.manage",
  "relationships.read", "relationships.manage", "signatures.read", "signatures.manage",
] as any;

export const providerConnectRoutes = new Hono<Env>()
  .use("*", withPrincipal)

  .get("/api/connect/google", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    return c.json(
      await providerOAuthService.buildAuthorizationUrl(
        principal,
        "gmail",
        (c.req.query("mode") || "readonly") as ProviderMode
      )
    );
  })

  .get("/api/connect/microsoft", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    return c.json(
      await providerOAuthService.buildAuthorizationUrl(
        principal,
        "outlook",
        (c.req.query("mode") || "readonly") as ProviderMode
      )
    );
  })

  .get("/auth/callback/google", async (c) => {
    try {
      const code = c.req.query("code") || "";
      const stateToken = c.req.query("state") || "";
      if (!code || !stateToken) throw new Error("Missing Google OAuth code/state");
      const state = await providerOAuthService.verifyState(stateToken, "gmail");
      const connected = await providerOAuthService.completeGoogleCallback(code, stateToken);
      const principal = { tenantId: state.tenantId, userId: state.userId, scopes: ownerScopes };
      let syncText = "No messages were synchronized yet.";
      try {
        const result = await syncService.syncAccount(principal, connected.accountId, 50);
        syncText = `${result.ingested} recent messages synchronized.`;
      } catch (syncError: any) {
        syncText = `The first synchronization failed: ${syncError.message}`;
      }
      return callbackPage(
        "Gmail connected",
        "This account is now readable by your vault. Mailwarden holds the provider credentials; your AI client never receives them.",
        [
          { term: "Account", value: connected.emailAddress },
          { term: "First sync", value: syncText },
        ],
        true
      );
    } catch (error: any) {
      return callbackPage("Gmail connection failed", error.message, [], false, 400);
    }
  })

  .get("/auth/callback/microsoft", async (c) => {
    try {
      const code = c.req.query("code") || "";
      const stateToken = c.req.query("state") || "";
      if (!code || !stateToken) throw new Error("Missing Microsoft OAuth code/state");
      const state = await providerOAuthService.verifyState(stateToken, "outlook");
      const connected = await providerOAuthService.completeMicrosoftCallback(code, stateToken);
      const principal = { tenantId: state.tenantId, userId: state.userId, scopes: ownerScopes };
      let syncText = "No messages were synchronized yet.";
      try {
        const result = await syncService.syncAccount(principal, connected.accountId, 50);
        syncText = `${result.ingested} recent messages synchronized.`;
      } catch (syncError: any) {
        syncText = `The first synchronization failed: ${syncError.message}`;
      }
      return callbackPage(
        "Outlook connected",
        "This account is now readable by your vault. Mailwarden holds the provider credentials; your AI client never receives them.",
        [
          { term: "Account", value: connected.emailAddress },
          { term: "First sync", value: syncText },
        ],
        true
      );
    } catch (error: any) {
      return callbackPage("Outlook connection failed", error.message, [], false, 400);
    }
  })

  .post("/api/accounts/:id/sync", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const body = await readBody(c);
    return c.json(
      await syncService.syncAccount(principal, c.req.param("id"), Number(body?.limit || 50))
    );
  })

  .post("/api/accounts/sync-all", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const body = await readBody(c);
    return c.json(await syncService.syncAll(principal, Number(body?.limitPerAccount || 50)));
  })

  .post("/api/connect/proton", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const input = await readBody(c);
    if (!input.gatewayUrl?.startsWith("https://") && !input.gatewayUrl?.startsWith("http://localhost")) {
      throw new ConfigurationError("Proton gatewayUrl must use HTTPS (localhost HTTP is allowed for local development)");
    }

    const now = new Date();
    const email = String(input.email).toLowerCase();
    let [account] = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId),
      eq(schema.emailAccounts.emailAddress, email)
    )).limit(1);

    if (!account) {
      const id = nanoid();
      await db.insert(schema.emailAccounts).values({
        id, tenantId: principal.tenantId, userId: principal.userId, provider: "proton",
        displayName: input.displayName || email, emailAddress: email, status: "connected",
        priorityRole: input.priorityRole || "personal", createdAt: now, updatedAt: now,
      });
      [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, id)).limit(1);
    }

    const encryptedCredentials = encryptionService.encryptJson({
      mode: "gateway", gatewayUrl: input.gatewayUrl.replace(/\/$/, ""), gatewayApiKey: input.gatewayApiKey,
    }, { tenantId: principal.tenantId, userId: principal.userId });

    const [connection] = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.accountId, account!.id)).limit(1);
    if (connection) {
      await db.update(schema.providerConnections).set({ encryptedCredentials, keyVersion: encryptedCredentials.keyVersion, updatedAt: now }).where(eq(schema.providerConnections.id, connection.id));
    } else {
      await db.insert(schema.providerConnections).values({
        id: nanoid(), tenantId: principal.tenantId, userId: principal.userId, accountId: account!.id,
        provider: "proton", encryptedCredentials, keyVersion: encryptedCredentials.keyVersion, createdAt: now, updatedAt: now,
      });
    }

    const [identity] = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.accountId, account!.id), eq(schema.emailIdentities.email, email)
    )).limit(1);
    if (!identity) {
      await db.insert(schema.emailIdentities).values({
        id: nanoid(), tenantId: principal.tenantId, userId: principal.userId, accountId: account!.id,
        email, displayName: input.displayName || email, canSend: true, createdAt: now, updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId, userId: principal.userId, action: "PROVIDER_CONNECT",
      resourceType: "account", resourceId: account!.id, details: { provider: "proton", emailAddress: email },
    });

    const syncResult = input.syncNow === false ? null : await syncService.syncAccount(principal, account!.id, input.limit || 50);
    return c.json({ accountId: account!.id, provider: "proton", emailAddress: email, sync: syncResult });
  })

  .get("/api/connect/status", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const accounts = await db.select({
      id: schema.emailAccounts.id, provider: schema.emailAccounts.provider, emailAddress: schema.emailAccounts.emailAddress,
      displayName: schema.emailAccounts.displayName, status: schema.emailAccounts.status,
      lastSyncedAt: schema.emailAccounts.lastSyncedAt, errorMessage: schema.emailAccounts.errorMessage,
    }).from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId), eq(schema.emailAccounts.userId, principal.userId)
    ));
    return c.json({ appBaseUrl: config.APP_BASE_URL, mailboxMutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED, providers: accounts });
  });
