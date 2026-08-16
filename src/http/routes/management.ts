import { Elysia } from "elysia";
import { authService } from "../../services/auth";
import { privacyService } from "../../services/privacy";
import { auditService } from "../../services/audit";
import { sendingService } from "../../services/sending";
import { draftService } from "../../services/drafts";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { AuthenticationError, NotFoundError } from "../../utils/errors";

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
    const recipients = toArray.map((r: any) => r.name ? `${r.name} &lt;${r.address}&gt;` : r.address).join(", ") || "(None)";
    const isExpired = approval.expiresAt < new Date();
    const isConfirmed = approval.status === "confirmed";
    const isSent = approval.status === "sent" || !!approval.usedAt;

    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailwarden - Review Outgoing Email</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc; --muted: #94a3b8; --accent: #3b82f6; --success: #10b981; --warn: #f59e0b; --danger: #ef4444; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; margin-top: 0; margin-bottom: 8px; color: var(--text); }
    .subtitle { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
    .field { margin-bottom: 16px; font-size: 14px; }
    .label { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .value { background: #0b1120; border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; word-break: break-word; font-family: inherit; }
    .body-preview { max-height: 180px; overflow-y: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
    .hash-badge { font-family: monospace; font-size: 11px; color: #38bdf8; background: #0369a120; padding: 6px 10px; border-radius: 4px; word-break: break-all; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
    .btn-submit { background: var(--success); color: #022c22; font-weight: 700; border: none; border-radius: 8px; padding: 14px 24px; width: 100%; font-size: 15px; cursor: pointer; transition: opacity 0.2s; }
    .btn-submit:hover { opacity: 0.9; }
    .footer-note { font-size: 12px; color: var(--muted); text-align: center; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🛡️ Review Outgoing Email</h1>
    <div class="subtitle">Mailwarden Human Authorization Check</div>

    ${
      isSent
        ? `<div class="status-badge" style="background:#064e3b;color:#34d399;">✓ This email has already been dispatched</div>`
        : isConfirmed
        ? `<div class="status-badge" style="background:#064e3b;color:#34d399;">✓ Authorized by human user. Return to ChatGPT to send.</div>`
        : isExpired
        ? `<div class="status-badge" style="background:#7f1d1d;color:#f87171;">✕ This approval challenge has expired</div>`
        : `<div class="status-badge" style="background:#78350f;color:#fcd34d;">⏳ Pending Human Authorization</div>`
    }

    <div class="field">
      <div class="label">Recipients</div>
      <div class="value">${recipients}</div>
    </div>

    <div class="field">
      <div class="label">Subject</div>
      <div class="value">${draft.subject || "(No Subject)"}</div>
    </div>

    <div class="field">
      <div class="label">Draft Body & Signature</div>
      <div class="value body-preview">${draft.textBody || ""}${draft.renderedSignature ? `\n\n--\n${draft.renderedSignature}` : ""}</div>
    </div>

    <div class="field">
      <div class="label">Canonical Payload SHA-256 Hash</div>
      <div class="hash-badge">${approval.payloadHash}</div>
    </div>

    ${
      !isSent && !isConfirmed && !isExpired
        ? `<form method="POST" action="/api/approvals/${approval.id}/confirm">
            <input type="hidden" name="confirmationNonce" value="${approval.confirmationNonce}">
            <button type="submit" class="btn-submit">Authorize & Confirm Send</button>
          </form>`
        : ""
    }

    <div class="footer-note">State is immutable on GET. Clicking 'Authorize & Confirm Send' performs an authenticated POST.</div>
  </div>
</body>
</html>`;
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
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Mailwarden - Authorized</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 36px; max-width: 480px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; color: #10b981; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
    .badge { background: #064e3b; color: #34d399; padding: 6px 12px; border-radius: 6px; font-family: monospace; font-size: 12px; display: inline-block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Authorization Confirmed</h1>
    <p>You have explicitly authorized this email dispatch.<br>Return to ChatGPT to complete the send.</p>
    <div class="badge">Approval: ${params.id}</div>
  </div>
</body>
</html>`;
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
