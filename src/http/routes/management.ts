import { Elysia } from "elysia";
import { authService } from "../../services/auth";
import { privacyService } from "../../services/privacy";
import { auditService } from "../../services/audit";
import { sendingService } from "../../services/sending";
import { draftService } from "../../services/drafts";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { AuthenticationError, NotFoundError } from "../../utils/errors";
import { config } from "../../config";
import { renderPage } from "../../ui/render";
import type { ApprovalState } from "../../ui/approval";
import { ApprovalConfirmedPage, ApprovalReviewPage } from "../../ui/approval.gen.js";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const managementRoutes = new Elysia({ prefix: "/api", aot: false })
  // Middleware to authenticate principal if Authorization header is present
  .derive(async ({ headers }) => {
    const authHeader = headers["authorization"];
    if (!authHeader) return { principal: null };
    try {
      const principal = await authService.verifyToken(authHeader);
      return { principal };
    } catch {
      return { principal: null };
    }
  })

  // List accounts
  .get("/accounts", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    return privacyService.listAccounts(principal);
  })

  // Export all user data (LGPD/GDPR)
  .get("/privacy/export", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    return privacyService.exportUserData(principal);
  })

  // Purge email bodies
  .post("/privacy/purge-bodies", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    return privacyService.deleteCachedEmailBodies(principal);
  })

  // Purge relationship memory
  .post("/privacy/purge-memory", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    await privacyService.deleteSenderMemory(principal);
    return { success: true, message: "Sender profiles and relationship memory purged" };
  })

  // Get audit log
  .get("/audit", async ({ principal, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const limit = (query as any)?.limit ? parseInt((query as any).limit, 10) : 50;
    return auditService.getEvents(principal.tenantId, principal.userId, limit);
  })

  // =========================================================================
  // SEND APPROVAL REVIEW (GET - Strictly idempotent, NEVER mutates state)
  // =========================================================================
  .get("/approvals/:id/review", async ({ params, set }) => {
    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, params.id))
      .limit(1);

    if (!approval) {
      set.status = 404;
      return "Approval challenge not found";
    }

    const [draft] = await db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.id, approval.draftId))
      .limit(1);

    if (!draft) {
      set.status = 404;
      return "Associated draft not found";
    }

    const rawTo = draft.to;
    const toArray = Array.isArray(rawTo) ? rawTo : typeof rawTo === "string" ? JSON.parse(rawTo) : [];
    // Escaping is the renderer's job now; build plain text and let Solid encode it.
    const recipients =
      toArray.map((r: any) => (r.name ? `${r.name} <${r.address}>` : r.address)).join(", ") ||
      "(nobody)";

    const state: ApprovalState =
      approval.status === "sent" || approval.usedAt
        ? "sent"
        : approval.status === "confirmed"
        ? "confirmed"
        : approval.expiresAt < new Date()
        ? "expired"
        : "pending";

    return renderPage("Review outgoing email", () =>
      ApprovalReviewPage({
        host: hostOf(config.APP_BASE_URL),
        state,
        recipients,
        subject: draft.subject || "(no subject)",
        body: `${draft.textBody || ""}${draft.renderedSignature ? `\n\n--\n${draft.renderedSignature}` : ""}`,
        fingerprint: approval.payloadHash,
        approvalId: approval.id,
        confirmationNonce: approval.confirmationNonce,
      })
    );
  })

  // Alias /approvals/:id/confirm (GET) -> delegates to safe review page (NEVER mutates state)
  .get("/approvals/:id/confirm", async ({ params, set }) => {
    set.redirect = `/api/approvals/${params.id}/review`;
  })

  // =========================================================================
  // SEND APPROVAL CONFIRMATION (POST - The ONLY way to transition to "confirmed")
  // =========================================================================
  .post("/approvals/:id/confirm", async ({ principal, params, body, headers, set }) => {
    const { db, schema } = await import("../../db");
    const { eq } = await import("drizzle-orm");

    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, params.id))
      .limit(1);

    if (!approval) {
      set.status = 404;
      return { error: "Approval not found" };
    }

    const confirmationNonce = (body as any)?.confirmationNonce;

    // Build principal from authenticated session OR verified challenge nonce
    let effectivePrincipal: any = principal;
    if (!effectivePrincipal) {
      if (confirmationNonce && approval.confirmationNonce === confirmationNonce) {
        effectivePrincipal = {
          tenantId: approval.tenantId,
          userId: approval.userId,
          scopes: ["mail.send", "mail.draft", "mail.read"],
        };
      } else {
        set.status = 401;
        return { error: "Unauthorized: valid session or matching confirmationNonce required" };
      }
    }

    const result = await sendingService.confirmSendApproval(effectivePrincipal, {
      approvalId: params.id,
      confirmationNonce,
    });

    const isHtmlRequest =
      headers["accept"]?.includes("text/html") ||
      headers["content-type"]?.includes("application/x-www-form-urlencoded");

    if (isHtmlRequest) {
      return renderPage("Approved", () =>
        ApprovalConfirmedPage({ host: hostOf(config.APP_BASE_URL), approvalId: params.id })
      );
    }

    return {
      success: true,
      approvalId: result.approvalId,
      status: "confirmed",
      confirmedAt: result.confirmedAt.toISOString(),
      message: "Send approval confirmed by human user. send_draft may now be invoked.",
    };
  })

  // Gmail OAuth scope helper (Capability-driven minimum privilege)
  .get("/accounts/oauth-url/google", async ({ principal, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { config } = await import("../../config");
    const mode = (query as any)?.mode || "readonly"; // readonly, actions, draft, full
    
    const scopeMap: Record<string, string[]> = {
      readonly: ["https://www.googleapis.com/auth/gmail.readonly", "email", "profile"],
      actions: ["https://www.googleapis.com/auth/gmail.modify", "email", "profile"],
      draft: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "email", "profile"],
      full: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "email", "profile"],
    };

    const scopes: string[] = scopeMap[mode] || scopeMap.readonly!;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", config.GOOGLE_CLIENT_ID || "");
    authUrl.searchParams.set("redirect_uri", `${config.APP_BASE_URL}/auth/callback/google`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("state", JSON.stringify({ tenantId: principal.tenantId, userId: principal.userId, mode }));

    return { authUrl: authUrl.toString(), requestedScopes: scopes, mode };
  })

  // Outlook OAuth scope helper (Capability-driven minimum privilege)
  .get("/accounts/oauth-url/microsoft", async ({ principal, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { config } = await import("../../config");
    const mode = (query as any)?.mode || "readonly";
    
    const scopeMap: Record<string, string[]> = {
      readonly: ["Mail.Read", "User.Read", "offline_access"],
      actions: ["Mail.ReadWrite", "User.Read", "offline_access"],
      draft: ["Mail.ReadWrite", "User.Read", "offline_access"],
      full: ["Mail.ReadWrite", "Mail.Send", "User.Read", "offline_access"],
    };

    const scopes: string[] = scopeMap[mode] || scopeMap.readonly!;
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", config.MICROSOFT_CLIENT_ID || "");
    authUrl.searchParams.set("redirect_uri", `${config.APP_BASE_URL}/auth/callback/microsoft`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("state", JSON.stringify({ tenantId: principal.tenantId, userId: principal.userId, mode }));

    return { authUrl: authUrl.toString(), requestedScopes: scopes, mode };
  })

  // =========================================================================
  // PROTON LOCAL CONNECTOR / HOSTED GATEWAY API
  // =========================================================================
  .post("/connectors/proton/register", async ({ principal, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { protonConnectorService } = await import("../../services/proton-connector");
    const b = body as any;
    return protonConnectorService.registerConnector(principal, {
      accountId: b.accountId,
      deviceName: b.deviceName,
      connectorType: b.connectorType,
      bridgeHost: b.bridgeHost,
      bridgeImapPort: b.bridgeImapPort,
      bridgeSmtpPort: b.bridgeSmtpPort,
      metadata: b.metadata,
    });
  })

  .post("/connectors/proton/heartbeat", async ({ headers, body }) => {
    const { protonConnectorService } = await import("../../services/proton-connector");
    const authHeader = headers["authorization"];
    const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const token = tokenFromHeader || (body as any)?.deviceToken;

    if (!token) throw new AuthenticationError("Device token required for heartbeat");

    const b = body as any;
    return protonConnectorService.processHeartbeat(token, {
      status: b?.status,
      errorMessage: b?.errorMessage,
      metadata: b?.metadata,
    });
  })

  .get("/connectors/proton/status/:accountId", async ({ principal, params, query }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { protonConnectorService } = await import("../../services/proton-connector");
    const { localizationService } = await import("../../services/localization");

    const connector = await protonConnectorService.getConnectorByAccountId(principal, params.accountId);
    const locale = localizationService.resolveLocale({ requestLanguage: (query as any)?.lang });
    const formatted = protonConnectorService.formatConnectorStatus(connector, locale);

    return {
      connector,
      formatted,
    };
  })

  // =========================================================================
  // USER PREFERENCES & EMAIL POLICIES
  // =========================================================================
  .get("/preferences", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { userPreferencesService } = await import("../../services/user-preferences");
    return userPreferencesService.getPreferences(principal);
  })

  .post("/preferences", async ({ principal, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { userPreferencesService } = await import("../../services/user-preferences");
    return userPreferencesService.updatePreferences(principal, body as any);
  })

  .get("/policies", async ({ principal }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    return policyService.getUserPolicies(principal);
  })

  .post("/policies", async ({ principal, body }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    return policyService.setPolicy(principal, body as any);
  })

  .delete("/policies/:id", async ({ principal, params }) => {
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    const success = await policyService.removePolicy(principal, params.id);
    return { success };
  });
