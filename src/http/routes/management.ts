import { Hono } from "hono";
import { authService } from "../../services/auth";
import { privacyService } from "../../services/privacy";
import { auditService } from "../../services/audit";
import { sendingService } from "../../services/sending";
import { userAuthService } from "../../services/user-auth";
import {
  humanSessionService,
  humanSessionCookie,
  humanSessionMaxAge,
  readHumanSessionCookie,
  type HumanSession,
} from "../../services/human-session";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { AuthenticationError } from "../../utils/errors";
import { config } from "../../config";
import { readBody, withPrincipal, type Env } from "../context";
import { renderPage } from "../../ui/render";
import type { ApprovalState } from "../../ui/approval";
import {
  ApprovalConfirmedPage,
  ApprovalReviewPage,
  ApprovalSignInPage,
} from "../../ui/approval.gen.js";
import { NoticePage } from "../../ui/pages.gen.js";
import { inboxStateService } from "../../services/inbox-state";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatAddresses(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
  const formatted = list
    .map((r: { name?: string; address?: string }) =>
      r.name ? `${r.name} <${r.address}>` : r.address || ""
    )
    .filter(Boolean)
    .join(", ");
  return formatted || "None";
}

function notFoundNotice() {
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
}

function originMatchesApp(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(config.APP_BASE_URL).origin;
  } catch {
    return false;
  }
}

async function requireHumanOwner(
  cookieHeader: string | undefined,
  approval: { tenantId: string; userId: string }
): Promise<HumanSession | null> {
  const human = await humanSessionService.tryVerify(readHumanSessionCookie(cookieHeader));
  if (!human) return null;
  if (human.tenantId !== approval.tenantId || human.userId !== approval.userId) return null;
  return human;
}

export const managementRoutes = new Hono<Env>()
  .basePath("/api")
  .use("*", withPrincipal)

  .get("/accounts", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    return c.json(await privacyService.listAccounts(principal));
  })

  .get("/triage", async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new AuthenticationError("Unauthorized");
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 100;
    return c.json(await inboxStateService.getInboxState(principal, { limit }));
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
  // Requires a valid mw_human_session cookie owned by the approval's human.
  // API/MCP bearers are deliberately ignored here.
  // =========================================================================
  .get("/approvals/:id/review", async (c) => {
    const approvalId = c.req.param("id");
    const humanToken = readHumanSessionCookie(c.req.header("cookie"));
    const human = await humanSessionService.tryVerify(humanToken);

    if (!human) {
      return renderPage(
        "Sign in to review",
        () =>
          ApprovalSignInPage({
            host: hostOf(config.APP_BASE_URL),
            approvalId,
          }),
        200,
        { peek: true }
      );
    }

    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approvalId))
      .limit(1);

    // Missing and cross-user look identical — do not reveal that another person's
    // approval exists.
    if (!approval || approval.tenantId !== human.tenantId || approval.userId !== human.userId) {
      return notFoundNotice();
    }

    const [draft] = await db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.id, approval.draftId))
      .limit(1);

    if (!draft) {
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
    }

    const [account] = await db
      .select()
      .from(schema.emailAccounts)
      .where(eq(schema.emailAccounts.id, draft.accountId))
      .limit(1);

    const state: ApprovalState =
      approval.status === "sent" || approval.usedAt
        ? "sent"
        : approval.status === "confirmed"
          ? "confirmed"
          : approval.expiresAt < new Date()
            ? "expired"
            : "pending";

    const bccList = Array.isArray(draft.bccAddresses) ? draft.bccAddresses : [];
    const attachmentList = Array.isArray(draft.attachments) ? draft.attachments : [];

    return renderPage("Review outgoing email", () =>
      ApprovalReviewPage({
        host: hostOf(config.APP_BASE_URL),
        state,
        fromAddress: account?.emailAddress || "(unknown)",
        recipients: formatAddresses(draft.toAddresses),
        cc: formatAddresses(draft.ccAddresses),
        bcc: bccList.length > 0 ? formatAddresses(draft.bccAddresses) : "None / unsupported",
        subject: draft.subject || "(no subject)",
        body: draft.textBody || "",
        threadContext: draft.threadId
          ? "Replying in an existing Gmail thread"
          : "New conversation",
        attachments: attachmentList.length > 0 ? `${attachmentList.length} attachment(s)` : "None",
        fingerprint: approval.payloadHash,
        approvalId: approval.id,
        confirmationNonce: approval.confirmationNonce,
      })
    );
  })

  // Alias /approvals/:id/confirm (GET) -> delegates to safe review page (NEVER mutates state)
  .get("/approvals/:id/confirm", (c) => c.redirect(`/api/approvals/${c.req.param("id")}/review`))

  // Sign in on the Mailwarden origin, then return to this approval's review URL only.
  .post("/approvals/:id/signin", async (c) => {
    const approvalId = c.req.param("id");
    const body = await readBody(c);
    const email = String(body.email || "");
    const loginSecret = String(body.login_secret || "");

    let user;
    try {
      user = await userAuthService.authenticateUser(email, loginSecret);
    } catch {
      return renderPage(
        "Sign in to review",
        () =>
          ApprovalSignInPage({
            host: hostOf(config.APP_BASE_URL),
            approvalId,
            error: "That email and password do not match a Mailwarden account.",
          }),
        401,
        { peek: true }
      );
    }

    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approvalId))
      .limit(1);

    if (!approval || approval.tenantId !== user.tenantId || approval.userId !== user.id) {
      return notFoundNotice();
    }

    const prior = readHumanSessionCookie(c.req.header("cookie"));
    const { token, expiresAt } = await humanSessionService.mintRotating(
      { id: user.id, tenantId: user.tenantId, email: user.email },
      prior
    );

    const response = c.redirect(`/api/approvals/${approvalId}/review`, 303);
    response.headers.append("Set-Cookie", humanSessionCookie(token, humanSessionMaxAge(expiresAt)));
    return response;
  })

  // =========================================================================
  // SEND APPROVAL CONFIRMATION (POST - The ONLY way to transition to "confirmed")
  // Requires human session ownership AND matching one-time confirmationNonce.
  // Nonce alone is not authentication. API/MCP bearers are not accepted here.
  // =========================================================================
  .post("/approvals/:id/confirm", async (c) => {
    const id = c.req.param("id");
    if (!originMatchesApp(c.req.header("origin"))) {
      return c.json({ error: "Origin mismatch" }, 403);
    }

    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, id))
      .limit(1);

    if (!approval) return c.json({ error: "Approval not found" }, 404);

    const human = await requireHumanOwner(c.req.header("cookie"), approval);
    if (!human) {
      return c.json({ error: "Human session required" }, 401);
    }

    const body = await readBody(c);
    const confirmationNonce = body?.confirmationNonce;
    if (!confirmationNonce) {
      return c.json({ error: "confirmationNonce required" }, 400);
    }

    // Synthesize a scoped principal only after human session ownership is proven.
    // The human cookie carries no mail scopes; confirmation is authorized by ownership.
    const effectivePrincipal = {
      tenantId: human.tenantId,
      userId: human.userId,
      scopes: ["mail.send", "mail.draft", "mail.read"] as const,
    };

    const result = await sendingService.confirmSendApproval(effectivePrincipal as any, {
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
