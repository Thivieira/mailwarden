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
import { AuthenticationError, AuthorizationError, ConfigurationError } from "../../utils/errors";
import { organizationService } from "../../services/organizations";
import { logger } from "../../utils/logger";

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

      // Trigger initial synchronization non-blockingly in background
      const syncTask = syncService.syncAccount(principal, connected.accountId, 20).catch(() => {});
      try {
        c.executionCtx.waitUntil(syncTask);
      } catch {
        // Safe fallback if executionCtx is absent
      }

      // Seamlessly redirect back to /portal dashboard with success notice
      return c.redirect(`/portal?connected=gmail&email=${encodeURIComponent(connected.emailAddress)}`);
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

      // Trigger initial synchronization non-blockingly in background
      const syncTask = syncService.syncAccount(principal, connected.accountId, 20).catch(() => {});
      try {
        c.executionCtx.waitUntil(syncTask);
      } catch {
        // Safe fallback if executionCtx is absent
      }

      // Seamlessly redirect back to /portal dashboard with success notice
      return c.redirect(`/portal?connected=outlook&email=${encodeURIComponent(connected.emailAddress)}`);
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

  .get("/api/connect/discover", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");

    const email = c.req.query("email") || "";
    const domain = c.req.query("domain") || "";
    if (!email && !domain) {
      throw new ConfigurationError("An email or domain parameter is required for discovery");
    }

    const { providerDiscoveryService } = await import("../../services/provider-discovery");
    if (email) {
      return c.json(await providerDiscoveryService.discoverForEmail(email));
    }
    return c.json(await providerDiscoveryService.discoverForDomain(domain));
  })

  .post("/api/connect/test", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");

    const input = await readBody(c);
    const emailAddress = String(input.email || input.emailAddress || input.username || "").toLowerCase().trim();
    if (!input.imapHost || !input.imapUsername) {
      throw new ConfigurationError("imapHost and imapUsername are required to test connection");
    }

    const credentials = {
      emailAddress,
      imap: {
        host: String(input.imapHost).trim(),
        port: Number(input.imapPort) || 993,
        secure: input.imapSecure !== undefined ? Boolean(input.imapSecure) : Number(input.imapPort) === 993,
        username: String(input.imapUsername).trim(),
        password: input.imapPassword ? String(input.imapPassword) : undefined,
      },
      smtp: input.smtpHost
        ? {
            host: String(input.smtpHost).trim(),
            port: Number(input.smtpPort) || 587,
            secure: input.smtpSecure !== undefined ? Boolean(input.smtpSecure) : Number(input.smtpPort) === 465,
            username: input.smtpUsername ? String(input.smtpUsername).trim() : String(input.imapUsername).trim(),
            password: input.smtpPassword ? String(input.smtpPassword) : input.imapPassword ? String(input.imapPassword) : undefined,
          }
        : undefined,
    };

    const { providerDiscoveryService } = await import("../../services/provider-discovery");
    return c.json(await providerDiscoveryService.testConnection(credentials));
  })

  .post("/api/connect/imap", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");

    const input = await readBody(c);
    const email = String(input.email || input.emailAddress || "").toLowerCase().trim();
    if (!email || !email.includes("@")) {
      throw new ConfigurationError("A valid email address is required");
    }
    if (!input.imapHost || !input.imapUsername) {
      throw new ConfigurationError("imapHost and imapUsername are required to connect IMAP");
    }

    const now = new Date();
    let [account] = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.emailAddress, email)
    )).limit(1);

    if (account && account.userId !== principal.userId) {
      throw new AuthorizationError("This workspace mailbox is already connected by another member");
    }

    const imapPort = Number(input.imapPort) || 993;
    const imapSecure = input.imapSecure !== undefined ? Boolean(input.imapSecure) : imapPort === 993;
    const smtpPort = input.smtpPort ? Number(input.smtpPort) : 587;
    const smtpSecure = input.smtpSecure !== undefined ? Boolean(input.smtpSecure) : smtpPort === 465;

    const creds = {
      emailAddress: email,
      imap: {
        host: String(input.imapHost).trim(),
        port: imapPort,
        secure: imapSecure,
        username: String(input.imapUsername).trim(),
        password: input.imapPassword ? String(input.imapPassword) : undefined,
      },
      smtp: input.smtpHost
        ? {
            host: String(input.smtpHost).trim(),
            port: smtpPort,
            secure: smtpSecure,
            username: input.smtpUsername ? String(input.smtpUsername).trim() : String(input.imapUsername).trim(),
            password: input.smtpPassword ? String(input.smtpPassword) : input.imapPassword ? String(input.imapPassword) : undefined,
          }
        : undefined,
    };

    if (!account) {
      await organizationService.requireMailboxCapacity(principal, principal.tenantId);
      const id = nanoid();
      await db.insert(schema.emailAccounts).values({
        id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        provider: "imap",
        displayName: input.displayName || email.split("@")[0] || email,
        emailAddress: email,
        status: "connected",
        priorityRole: input.priorityRole || "primary_work",
        createdAt: now,
        updatedAt: now,
      });
      [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, id)).limit(1);
    } else {
      await db.update(schema.emailAccounts).set({
        provider: "imap",
        displayName: input.displayName || email.split("@")[0] || email,
        status: "connected",
        errorMessage: null,
        updatedAt: now,
      }).where(eq(schema.emailAccounts.id, account.id));
    }

    const encryptedCredentials = encryptionService.encryptJson(creds, {
      tenantId: principal.tenantId,
      userId: principal.userId,
    });

    const [connection] = await db.select().from(schema.providerConnections)
      .where(eq(schema.providerConnections.accountId, account!.id)).limit(1);

    if (connection) {
      await db.update(schema.providerConnections).set({
        provider: "imap",
        encryptedCredentials,
        keyVersion: encryptedCredentials.keyVersion,
        updatedAt: now,
      }).where(eq(schema.providerConnections.id, connection.id));
    } else {
      await db.insert(schema.providerConnections).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        accountId: account!.id,
        provider: "imap",
        encryptedCredentials,
        keyVersion: encryptedCredentials.keyVersion,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [identity] = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.accountId, account!.id),
      eq(schema.emailIdentities.email, email)
    )).limit(1);

    if (!identity) {
      await db.insert(schema.emailIdentities).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        accountId: account!.id,
        email,
        displayName: input.displayName || email.split("@")[0] || email,
        canSend: Boolean(input.smtpHost),
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PROVIDER_CONNECT",
      resourceType: "account",
      resourceId: account!.id,
      details: { provider: "imap", emailAddress: email, imapHost: input.imapHost },
    });

    let syncResult = null;
    if (input.syncNow !== false) {
      try {
        syncResult = await syncService.syncAccount(principal, account!.id, input.limit || 25);
      } catch (err: any) {
        logger.warn("Initial sync for IMAP account failed", { error: err.message });
      }
    }

    return c.json({
      accountId: account!.id,
      provider: "imap",
      emailAddress: email,
      status: "connected",
      sync: syncResult,
    });
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
      eq(schema.emailAccounts.emailAddress, email)
    )).limit(1);
    if (account && account.userId !== principal.userId) {
      throw new AuthorizationError("This workspace mailbox is already connected by another member");
    }

    if (!account) {
      await organizationService.requireMailboxCapacity(principal, principal.tenantId);
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
