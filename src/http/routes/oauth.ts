import { Elysia, t } from "elysia";
import { oauthService } from "../../services/oauth";
import { userAuthService } from "../../services/user-auth";
import { ALL_SCOPES, type PermissionScope } from "../../types/auth";
import { config } from "../../config";
import { renderPage } from "../../ui/render";
import { fingerprint, groupHex } from "../../ui/randomart";
import { AuthorizePage, DeniedPage } from "../../ui/pages.gen.js";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Visual + hex fingerprint of the exact authorization request. Bound to the client, the
 * return address, and the PKCE challenge, so a request that differs in any of them draws
 * a different picture.
 */
async function requestFingerprint(params: Record<string, string>) {
  const attested = [params.client_id, params.redirect_uri, params.code_challenge, params.scope]
    .map((v) => v ?? "")
    .join("\n");
  const { rows, hex } = await fingerprint(attested);
  return { rows, digest: groupHex(hex, 8) };
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

  // Browser authorization page used by ChatGPT. Every beta user signs in to a separate private vault.
  .get("/oauth/authorize", async ({ query, set }) => {
    const q = query as any;
    if (q.response_type !== "code") {
      set.status = 400;
      return { error: "unsupported_response_type", error_description: "Only response_type=code is supported" };
    }
    if (!q.code_challenge || (q.code_challenge_method && q.code_challenge_method !== "S256")) {
      set.status = 400;
      return { error: "invalid_request", error_description: "PKCE S256 code_challenge is mandatory" };
    }
    let client;
    try {
      client = await oauthService.validateClient(q.client_id, q.redirect_uri);
    } catch (err: any) {
      set.status = 400;
      return { error: "invalid_client", error_description: err.message };
    }

    const params: Record<string, string> = {};
    for (const name of ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]) {
      params[name] = String(q[name] ?? "");
    }

    // Drawn from the exact request, so the picture changes if any of it is forged.
    const { rows, digest } = await requestFingerprint(params);

    return renderPage("Authorize Mailwarden", () =>
      AuthorizePage({
        host: hostOf(config.APP_BASE_URL),
        clientName: (client as any)?.clientName || "this client",
        scopes: q.scope ? String(q.scope).split(" ").filter(Boolean) : ALL_SCOPES,
        mutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED,
        rows,
        digest,
        params,
      })
    );
  })

  .post("/oauth/authorize", async ({ body, set }) => {
    const b = body as any;
    let client;
    try {
      client = await oauthService.validateClient(b.client_id, b.redirect_uri);
    } catch (err: any) {
      set.status = 400;
      return { error: "invalid_client", error_description: err.message };
    }

    let user;
    try {
      user = await userAuthService.authenticateUser(String(b.email || ""), String(b.login_secret || ""));
    } catch {
      return renderPage(
        "Authorization denied",
        () =>
          DeniedPage({
            host: hostOf(config.APP_BASE_URL),
            reason: "That email and login secret do not match a Mailwarden vault.",
          }),
        401
      );
    }

    const requestedScopes = b.scope ? (String(b.scope).split(" ") as PermissionScope[]) : ALL_SCOPES;
    const allowedScopes = requestedScopes.filter(
      (scope) => ALL_SCOPES.includes(scope) && client.allowedScopes.includes(scope)
    );
    const code = await oauthService.createAuthorizationCode({
      clientId: b.client_id,
      tenantId: user.tenantId,
      userId: user.id,
      scopes: allowedScopes,
      resource: b.resource || config.APP_BASE_URL,
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      codeChallengeMethod: "S256",
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
