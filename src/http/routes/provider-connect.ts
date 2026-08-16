import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authService } from "../../services/auth";
import { providerOAuthService, type ProviderMode } from "../../services/provider-oauth";
import { syncService } from "../../services/sync";
import { encryptionService } from "../../services/encryption";
import { auditService } from "../../services/audit";
import { db, schema } from "../../db";
import { config } from "../../config";
import { AuthenticationError, ConfigurationError } from "../../utils/errors";

const providerMode = t.Union([
  t.Literal("readonly"),
  t.Literal("actions"),
  t.Literal("draft"),
  t.Literal("full"),
]);

function callbackHtml(title: string, body: string, success = true) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui;background:#0f172a;color:#f8fafc;padding:40px"><main style="max-width:640px;margin:auto;background:#1e293b;padding:32px;border-radius:14px"><h1 style="color:${success ? "#34d399" : "#f87171"}">${title}</h1><p style="line-height:1.6">${body}</p><p style="color:#94a3b8">You can close this tab and return to ChatGPT.</p></main></body></html>`;
}

export const providerConnectRoutes = new Elysia({ aot: false })
  .derive(async ({ headers }) => {
    const authHeader = headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) return { principal: null };
    try {
      return { principal: await authService.verifyToken(authHeader.slice(7)) };
    } catch {
      return { principal: null };
    }
  })

  .get("/api/connect/google", async ({ principal, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const mode = ((query as any)?.mode || "readonly") as ProviderMode;
    return providerOAuthService.buildAuthorizationUrl(principal, "gmail", mode);
  })

  .get("/api/connect/microsoft", async ({ principal, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const mode = ((query as any)?.mode || "readonly") as ProviderMode;
    return providerOAuthService.buildAuthorizationUrl(principal, "outlook", mode);
  })

  .get("/auth/callback/google", async ({ query, set }) => {
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    try {
      if (!(query as any).code || !(query as any).state) throw new Error("Missing Google OAuth code/state");
      const connected = await providerOAuthService.completeGoogleCallback(String((query as any).code), String((query as any).state));
      const principal = { tenantId: (await providerOAuthService.verifyState(String((query as any).state), "gmail")).tenantId, userId: (await providerOAuthService.verifyState(String((query as any).state), "gmail")).userId, scopes: ["mail.read", "mail.search", "mail.modify", "mail.archive", "mail.draft", "mail.send", "accounts.read", "accounts.manage", "profile.read", "profile.manage", "relationships.read", "relationships.manage", "signatures.read", "signatures.manage"] as any };
      let syncText = "Connection saved.";
      try {
        const result = await syncService.syncAccount(principal, connected.accountId, 50);
        syncText = `Connection saved and ${result.ingested} recent messages were synchronized.`;
      } catch (syncError: any) {
        syncText = `Connection saved, but the first synchronization failed: ${syncError.message}`;
      }
      return callbackHtml("Gmail connected", `${connected.emailAddress}<br><br>${syncText}`);
    } catch (error: any) {
      set.status = 400;
      return callbackHtml("Gmail connection failed", error.message, false);
    }
  })

  .get("/auth/callback/microsoft", async ({ query, set }) => {
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    try {
      if (!(query as any).code || !(query as any).state) throw new Error("Missing Microsoft OAuth code/state");
      const state = await providerOAuthService.verifyState(String((query as any).state), "outlook");
      const connected = await providerOAuthService.completeMicrosoftCallback(String((query as any).code), String((query as any).state));
      const principal = { tenantId: state.tenantId, userId: state.userId, scopes: ["mail.read", "mail.search", "mail.modify", "mail.archive", "mail.draft", "mail.send", "accounts.read", "accounts.manage", "profile.read", "profile.manage", "relationships.read", "relationships.manage", "signatures.read", "signatures.manage"] as any };
      let syncText = "Connection saved.";
      try {
        const result = await syncService.syncAccount(principal, connected.accountId, 50);
        syncText = `Connection saved and ${result.ingested} recent messages were synchronized.`;
      } catch (syncError: any) {
        syncText = `Connection saved, but the first synchronization failed: ${syncError.message}`;
      }
      return callbackHtml("Outlook connected", `${connected.emailAddress}<br><br>${syncText}`);
    } catch (error: any) {
      set.status = 400;
      return callbackHtml("Outlook connection failed", error.message, false);
    }
  })

  .post("/api/accounts/:id/sync", async ({ principal, params, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const limit = Number((body as any)?.limit || 50);
    return syncService.syncAccount(principal, params.id, limit);
  }, { body: t.Optional(t.Object({ limit: t.Optional(t.Number()) })) })

  .post("/api/accounts/sync-all", async ({ principal, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const limit = Number((body as any)?.limitPerAccount || 50);
    return syncService.syncAll(principal, limit);
  }, { body: t.Optional(t.Object({ limitPerAccount: t.Optional(t.Number()) })) })

  // Proton Bridge is connected through an HTTPS gateway/tunnel beside Bridge.
  .post("/api/connect/proton", async ({ principal, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    authService.requireScope(principal, "accounts.manage");
    const input = body as any;
    if (!input.gatewayUrl?.startsWith("https://") && !input.gatewayUrl?.startsWith("http://localhost")) {
      throw new ConfigurationError("Proton gatewayUrl must use HTTPS (localhost HTTP is allowed for local development)");
    }

    const now = new Date();
    const email = input.email.toLowerCase();
    let [account] = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId),
      eq(schema.emailAccounts.emailAddress, email)
    )).limit(1);

    if (!account) {
      const id = nanoid();
      await db.insert(schema.emailAccounts).values({
        id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        provider: "proton",
        displayName: input.displayName || email,
        emailAddress: email,
        status: "connected",
        priorityRole: input.priorityRole || "personal",
        createdAt: now,
        updatedAt: now,
      });
      [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, id)).limit(1);
    }

    const encryptedCredentials = encryptionService.encryptJson({
      mode: "gateway",
      gatewayUrl: input.gatewayUrl.replace(/\/$/, ""),
      gatewayApiKey: input.gatewayApiKey,
    }, { tenantId: principal.tenantId, userId: principal.userId });

    const [connection] = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.accountId, account!.id)).limit(1);
    if (connection) {
      await db.update(schema.providerConnections).set({
        encryptedCredentials,
        keyVersion: encryptedCredentials.keyVersion,
        updatedAt: now,
      }).where(eq(schema.providerConnections.id, connection.id));
    } else {
      await db.insert(schema.providerConnections).values({
        id: nanoid(), tenantId: principal.tenantId, userId: principal.userId, accountId: account!.id,
        provider: "proton", encryptedCredentials, keyVersion: encryptedCredentials.keyVersion,
        createdAt: now, updatedAt: now,
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
      tenantId: principal.tenantId, userId: principal.userId, action: "PROVIDER_CONNECTED",
      resourceType: "account", resourceId: account!.id, details: { provider: "proton", emailAddress: email },
    });

    const syncResult = input.syncNow === false ? null : await syncService.syncAccount(principal, account!.id, input.limit || 50);
    return { accountId: account!.id, provider: "proton", emailAddress: email, sync: syncResult };
  }, {
    body: t.Object({
      email: t.String(),
      displayName: t.Optional(t.String()),
      gatewayUrl: t.String(),
      gatewayApiKey: t.String(),
      priorityRole: t.Optional(t.String()),
      syncNow: t.Optional(t.Boolean()),
      limit: t.Optional(t.Number()),
    }),
  })

  .get("/api/connect/status", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const accounts = await db.select({
      id: schema.emailAccounts.id,
      provider: schema.emailAccounts.provider,
      emailAddress: schema.emailAccounts.emailAddress,
      displayName: schema.emailAccounts.displayName,
      status: schema.emailAccounts.status,
      lastSyncedAt: schema.emailAccounts.lastSyncedAt,
      errorMessage: schema.emailAccounts.errorMessage,
    }).from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId)
    ));
    return {
      appBaseUrl: config.APP_BASE_URL,
      mailboxMutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED,
      providers: accounts,
    };
  });
