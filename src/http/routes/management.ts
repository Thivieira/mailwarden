import { Hono } from "hono";
import { authService } from "../../services/auth";
import { privacyService } from "../../services/privacy";
import { auditService } from "../../services/audit";
import { sendingService } from "../../services/sending";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { AuthenticationError } from "../../utils/errors";
import { config } from "../../config";
import { readBody, withPrincipal, type Env } from "../context";
import { renderPage } from "../../ui/render";
import type { ApprovalState } from "../../ui/approval";
import { ApprovalConfirmedPage, ApprovalReviewPage } from "../../ui/approval.gen.js";
import { NoticePage } from "../../ui/pages.gen.js";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const managementRoutes = new Hono<Env>()
  .basePath("/api")
  .use("*", withPrincipal)

  .get("/accounts", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    return c.json(await privacyService.listAccounts(principal));
  })

  .get("/privacy/export", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    return c.json(await privacyService.exportUserData(principal));
  })

  .post("/privacy/purge-bodies", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    return c.json(await privacyService.deleteCachedEmailBodies(principal));
  })

  .post("/privacy/purge-memory", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    await privacyService.deleteSenderMemory(principal);
    return c.json({ success: true, message: "Sender profiles and relationship memory purged" });
  })

  .get("/audit", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50;
    return c.json(await auditService.getEvents(principal.tenantId, principal.userId, limit));
  })

  // =========================================================================
  // SEND APPROVAL REVIEW (GET - Strictly idempotent, NEVER mutates state)
  // =========================================================================
  .get("/approvals/:id/review", async (c) => {
    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, c.req.param("id")))
      .limit(1);

    if (!approval)
      return renderPage(
        "Request not found",
        () =>
          NoticePage({
            host: hostOf(config.APP_BASE_URL),
            headline: "This link has expired",
            detail: "There is no pending email waiting for approval at this address.",
            hint: "Approval links are single-use and time-limited. Go back to your conversation and ask for the email again; nothing was sent.",
          }),
        404
      );

    const [draft] = await db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.id, approval.draftId))
      .limit(1);

    if (!draft)
      return renderPage(
        "Request not found",
        () =>
          NoticePage({
            host: hostOf(config.APP_BASE_URL),
            headline: "This email is no longer available",
            detail: "The draft this approval refers to has been removed.",
            hint: "Nothing was sent. Go back to your conversation and ask for the email again.",
          }),
        404
      );

    const rawTo = draft.to;
    const toArray = Array.isArray(rawTo) ? rawTo : typeof rawTo === "string" ? JSON.parse(rawTo) : [];
    // Escaping is the renderer's job; build plain text and let Solid encode it.
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
  .get("/approvals/:id/confirm", (c) => c.redirect(`/api/approvals/${c.req.param("id")}/review`))

  // =========================================================================
  // SEND APPROVAL CONFIRMATION (POST - The ONLY way to transition to "confirmed")
  // =========================================================================
  .post("/approvals/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, id))
      .limit(1);

    if (!approval) return c.json({ error: "Approval not found" }, 404);

    const body = await readBody(c);
    const confirmationNonce = body?.confirmationNonce;

    // Build principal from authenticated session OR verified challenge nonce
    let effectivePrincipal: any = c.get("principal");
    if (!effectivePrincipal) {
      if (confirmationNonce && approval.confirmationNonce === confirmationNonce) {
        effectivePrincipal = {
          tenantId: approval.tenantId,
          userId: approval.userId,
          scopes: ["mail.send", "mail.draft", "mail.read"],
        };
      } else {
        return c.json(
          { error: "Unauthorized: valid session or matching confirmationNonce required" },
          401
        );
      }
    }

    const result = await sendingService.confirmSendApproval(effectivePrincipal, {
      approvalId: id,
      confirmationNonce,
    });

    const isHtmlRequest =
      c.req.header("accept")?.includes("text/html") ||
      c.req.header("content-type")?.includes("application/x-www-form-urlencoded");

    if (isHtmlRequest) {
      return renderPage("Approved", () =>
        ApprovalConfirmedPage({ host: hostOf(config.APP_BASE_URL), approvalId: id })
      );
    }

    return c.json({
      success: true,
      approvalId: result.approvalId,
      status: "confirmed",
      confirmedAt: result.confirmedAt.toISOString(),
      message: "Send approval confirmed by human user. send_draft may now be invoked.",
    });
  })

  // Gmail OAuth scope helper (Capability-driven minimum privilege)
  .get("/accounts/oauth-url/google", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const mode = c.req.query("mode") || "readonly"; // readonly, actions, draft, full

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

    return c.json({ authUrl: authUrl.toString(), requestedScopes: scopes, mode });
  })

  // Outlook OAuth scope helper (Capability-driven minimum privilege)
  .get("/accounts/oauth-url/microsoft", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const mode = c.req.query("mode") || "readonly";

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

    return c.json({ authUrl: authUrl.toString(), requestedScopes: scopes, mode });
  })

  // =========================================================================
  // PROTON LOCAL CONNECTOR / HOSTED GATEWAY API
  // =========================================================================
  .post("/connectors/proton/register", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { protonConnectorService } = await import("../../services/proton-connector");
    const b = await readBody(c);
    return c.json(
      await protonConnectorService.registerConnector(principal, {
        accountId: b.accountId,
        deviceName: b.deviceName,
        connectorType: b.connectorType,
        bridgeHost: b.bridgeHost,
        bridgeImapPort: b.bridgeImapPort,
        bridgeSmtpPort: b.bridgeSmtpPort,
        metadata: b.metadata,
      })
    );
  })

  .post("/connectors/proton/heartbeat", async (c) => {
    const { protonConnectorService } = await import("../../services/proton-connector");
    const b = await readBody(c);
    const authHeader = c.req.header("authorization");
    const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const token = tokenFromHeader || b?.deviceToken;

    if (!token) throw new AuthenticationError("Device token required for heartbeat");

    return c.json(
      await protonConnectorService.processHeartbeat(token, {
        status: b?.status,
        errorMessage: b?.errorMessage,
        metadata: b?.metadata,
      })
    );
  })

  .get("/connectors/proton/status/:accountId", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { protonConnectorService } = await import("../../services/proton-connector");
    const { localizationService } = await import("../../services/localization");

    const connector = await protonConnectorService.getConnectorByAccountId(
      principal,
      c.req.param("accountId")
    );
    const locale = localizationService.resolveLocale({ requestLanguage: c.req.query("lang") });
    const formatted = protonConnectorService.formatConnectorStatus(connector, locale);

    return c.json({ connector, formatted });
  })

  // =========================================================================
  // USER PREFERENCES & EMAIL POLICIES
  // =========================================================================
  .get("/preferences", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { userPreferencesService } = await import("../../services/user-preferences");
    return c.json(await userPreferencesService.getPreferences(principal));
  })

  .post("/preferences", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { userPreferencesService } = await import("../../services/user-preferences");
    return c.json(await userPreferencesService.updatePreferences(principal, (await readBody(c)) as any));
  })

  .get("/policies", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    return c.json(await policyService.getUserPolicies(principal));
  })

  .post("/policies", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    return c.json(await policyService.setPolicy(principal, (await readBody(c)) as any));
  })

  .delete("/policies/:id", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const { policyService } = await import("../../services/policy");
    const success = await policyService.removePolicy(principal, c.req.param("id"));
    return c.json({ success });
  });
