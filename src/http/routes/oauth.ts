import { Elysia, t } from "elysia";
import { oauthService } from "../../services/oauth";
import { authService } from "../../services/auth";
import { ALL_SCOPES, type PermissionScope } from "../../types/auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function resolveOwner(email: string) {
  const normalized = email.toLowerCase();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1);
  if (!user) {
    const created = await authService.createTenantAndOwner({
      tenantName: "Personal Mailwarden",
      slug: `personal-${nanoid(8)}`,
      ownerEmail: normalized,
      ownerDisplayName: normalized.split("@")[0] || "Owner",
    });
    [user] = await db.select().from(schema.users).where(eq(schema.users.id, created.userId)).limit(1);
  }
  return user!;
}

export const oauthRoutes = new Elysia({ aot: false })
  .get("/.well-known/oauth-authorization-server", () => ({
    issuer: config.APP_BASE_URL,
    authorization_endpoint: `${config.APP_BASE_URL}/oauth/authorize`,
    token_endpoint: `${config.APP_BASE_URL}/oauth/token`,
    registration_endpoint: `${config.APP_BASE_URL}/oauth/register`,
    revocation_endpoint: `${config.APP_BASE_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ALL_SCOPES,
    resource_indicators_supported: true,
  }))

  .get("/.well-known/oauth-protected-resource", () => ({
    resource: config.APP_BASE_URL,
    authorization_servers: [config.APP_BASE_URL],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.APP_BASE_URL}/swagger`,
  }))

  .post("/oauth/register", async ({ body, set }) => {
    const { client_name, redirect_uris, scope, grant_types, token_endpoint_auth_method } = body as any;
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      set.status = 400;
      return { error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required" };
    }

    const isPublic = token_endpoint_auth_method === "none";
    const registered = await oauthService.registerClient({
      clientName: client_name || "ChatGPT MCP Client",
      redirectUris: redirect_uris,
      allowedScopes: scope ? scope.split(" ") : ALL_SCOPES,
      isPublic,
    });

    set.status = 201;
    return {
      client_id: registered.clientId,
      client_secret: registered.clientSecret,
      client_name: client_name || "ChatGPT MCP Client",
      redirect_uris,
      grant_types: grant_types || ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: isPublic ? "none" : "client_secret_post",
    };
  }, { body: t.Any() })

  // Browser authorization page used by ChatGPT. For the current dogfood deployment this is intentionally single-owner.
  .get("/oauth/authorize", async ({ query, set }) => {
    const q = query as any;
    if (q.response_type !== "code") {
      set.status = 400;
      return { error: "unsupported_response_type", error_description: "Only response_type=code is supported" };
    }
    if (!q.code_challenge) {
      set.status = 400;
      return { error: "invalid_request", error_description: "PKCE code_challenge is mandatory" };
    }
    try {
      await oauthService.validateClient(q.client_id, q.redirect_uri);
    } catch (err: any) {
      set.status = 400;
      return { error: "invalid_client", error_description: err.message };
    }

    if (!config.OWNER_EMAIL || !config.OWNER_LOGIN_SECRET) {
      set.status = 503;
      return { error: "owner_auth_not_configured", error_description: "Set OWNER_EMAIL and OWNER_LOGIN_SECRET before connecting ChatGPT" };
    }

    const hidden = [
      "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"
    ].map((name) => `<input type="hidden" name="${name}" value="${esc(q[name])}">`).join("");

    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Mailwarden</title></head>
<body style="font-family:system-ui;background:#0f172a;color:#f8fafc;padding:32px"><main style="max-width:520px;margin:5vh auto;background:#1e293b;padding:32px;border-radius:14px">
<h1>Connect ChatGPT to Mailwarden</h1><p style="color:#94a3b8">Sign in as the owner of this Mailwarden deployment. ChatGPT will only receive the scopes shown below.</p>
<p><strong>Scopes:</strong> ${esc(q.scope || ALL_SCOPES.join(" "))}</p>
<form method="POST" action="/oauth/authorize">${hidden}
<label style="display:block;margin:16px 0 6px">Email</label><input name="email" type="email" required value="${esc(config.OWNER_EMAIL)}" style="width:100%;padding:12px;box-sizing:border-box">
<label style="display:block;margin:16px 0 6px">Mailwarden login secret</label><input name="login_secret" type="password" required style="width:100%;padding:12px;box-sizing:border-box">
<button type="submit" style="margin-top:22px;width:100%;padding:13px;background:#10b981;border:0;border-radius:8px;font-weight:700">Authorize ChatGPT</button>
</form></main></body></html>`;
  })

  .post("/oauth/authorize", async ({ body, set }) => {
    const b = body as any;
    try {
      await oauthService.validateClient(b.client_id, b.redirect_uri);
    } catch (err: any) {
      set.status = 400;
      return { error: "invalid_client", error_description: err.message };
    }

    if (!config.OWNER_EMAIL || !config.OWNER_LOGIN_SECRET) {
      set.status = 503;
      return { error: "owner_auth_not_configured" };
    }
    if (String(b.email || "").toLowerCase() !== config.OWNER_EMAIL.toLowerCase() || b.login_secret !== config.OWNER_LOGIN_SECRET) {
      set.status = 401;
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return "<h1>Authorization denied</h1><p>Invalid Mailwarden owner credentials.</p>";
    }

    const user = await resolveOwner(b.email);
    const requestedScopes = b.scope ? (String(b.scope).split(" ") as PermissionScope[]) : ALL_SCOPES;
    const allowedScopes = requestedScopes.filter((s) => ALL_SCOPES.includes(s));
    const code = await oauthService.createAuthorizationCode({
      clientId: b.client_id,
      tenantId: user.tenantId,
      userId: user.id,
      scopes: allowedScopes,
      resource: b.resource || config.APP_BASE_URL,
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      codeChallengeMethod: b.code_challenge_method || "S256",
    });

    const redirectUrl = new URL(b.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (b.state) redirectUrl.searchParams.set("state", b.state);
    set.redirect = redirectUrl.toString();
  }, { body: t.Any() })

  .post("/oauth/token", async ({ body, set }) => {
    const { grant_type, client_id, code, code_verifier, redirect_uri, refresh_token, resource } = body as any;

    if (grant_type === "authorization_code") {
      if (!code || !code_verifier) {
        set.status = 400;
        return { error: "invalid_request", error_description: "code and code_verifier are required" };
      }
      try {
        return await oauthService.exchangeCodeForToken({
          clientId: client_id,
          code,
          codeVerifier: code_verifier,
          redirectUri: redirect_uri,
          resource,
        });
      } catch (err: any) {
        set.status = 400;
        return { error: "invalid_grant", error_description: err.message };
      }
    }

    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        set.status = 400;
        return { error: "invalid_request", error_description: "refresh_token is required" };
      }
      try {
        return await oauthService.refreshAccessToken({ clientId: client_id, refreshToken: refresh_token, resource });
      } catch (err: any) {
        set.status = 400;
        return { error: "invalid_grant", error_description: err.message };
      }
    }

    set.status = 400;
    return { error: "unsupported_grant_type", error_description: "Supported grant_types: authorization_code, refresh_token" };
  }, { body: t.Any() })

  .post("/oauth/revoke", async ({ body }) => {
    const { token, client_id } = body as any;
    if (token) await oauthService.revokeToken({ token, clientId: client_id });
    return { success: true };
  }, { body: t.Any() });
