import { Hono } from "hono";
import { oauthService } from "../../services/oauth";
import { userAuthService } from "../../services/user-auth";
import {
  humanSessionService,
  humanSessionCookie,
  humanSessionMaxAge,
  readHumanSessionCookie,
} from "../../services/human-session";
import { ALL_SCOPES, type PermissionScope } from "../../types/auth";
import { config } from "../../config";
import { readBody } from "../context";
import { renderPage } from "../../ui/render";
import { AuthorizePage, DeniedPage } from "../../ui/pages.gen.js";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const HIDDEN_PARAMS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

export const oauthRoutes = new Hono()
  .get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
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
    })
  )

  .get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource: config.APP_BASE_URL,
      authorization_servers: [config.APP_BASE_URL],
      scopes_supported: ALL_SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: `${config.APP_BASE_URL}/swagger`,
    })
  )

  .post("/oauth/register", async (c) => {
    const { client_name, redirect_uris, scope, grant_types, token_endpoint_auth_method } =
      await readBody(c);
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return c.json(
        { error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required" },
        400
      );
    }

    const isPublic = token_endpoint_auth_method === "none";
    const registered = await oauthService.registerClient({
      clientName: client_name || "ChatGPT MCP Client",
      redirectUris: redirect_uris,
      allowedScopes: scope ? scope.split(" ") : ALL_SCOPES,
      isPublic,
    });

    return c.json(
      {
        client_id: registered.clientId,
        client_secret: registered.clientSecret,
        client_name: client_name || "ChatGPT MCP Client",
        redirect_uris,
        grant_types: grant_types || ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: isPublic ? "none" : "client_secret_post",
      },
      201
    );
  })

  // Browser authorization page. Every beta user signs in to a separate private vault.
  .get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    if (q.response_type !== "code") {
      return c.json(
        { error: "unsupported_response_type", error_description: "Only response_type=code is supported" },
        400
      );
    }
    if (!q.code_challenge || (q.code_challenge_method && q.code_challenge_method !== "S256")) {
      return c.json(
        { error: "invalid_request", error_description: "PKCE S256 code_challenge is mandatory" },
        400
      );
    }

    let client;
    try {
      client = await oauthService.validateClient(q.client_id!, q.redirect_uri!);
    } catch (err: any) {
      return c.json({ error: "invalid_client", error_description: err.message }, 400);
    }

    const params: Record<string, string> = {};
    for (const name of HIDDEN_PARAMS) params[name] = String(q[name] ?? "");

    // `peek` is the only page that opts into a script, and it admits exactly one by hash.
    return renderPage(
      "Authorize Mailwarden",
      () =>
        AuthorizePage({
          host: hostOf(config.APP_BASE_URL),
          clientName: (client as any)?.clientName || "this client",
          scopes: q.scope ? String(q.scope).split(" ").filter(Boolean) : ALL_SCOPES,
          mutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED,
          params,
        }),
      200,
      { peek: true }
    );
  })

  .post("/oauth/authorize", async (c) => {
    const b = await readBody(c);
    let client;
    try {
      client = await oauthService.validateClient(b.client_id, b.redirect_uri);
    } catch (err: any) {
      return c.json({ error: "invalid_client", error_description: err.message }, 400);
    }

    let user;
    try {
      user = await userAuthService.authenticateUser(
        String(b.email || ""),
        String(b.login_secret || "")
      );
    } catch {
      return renderPage("Authorization denied", () => DeniedPage({ host: hostOf(config.APP_BASE_URL) }), 401);
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

    // Mint a human browser session on the Mailwarden origin so later approval review/confirm
    // can require a real human cookie. Never put this token in the OAuth code or MCP bearer.
    const prior = readHumanSessionCookie(c.req.header("cookie"));
    const { token: humanToken, expiresAt } = await humanSessionService.mintRotating(
      { id: user.id, tenantId: user.tenantId, email: user.email },
      prior
    );

    const redirectUrl = new URL(b.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (b.state) redirectUrl.searchParams.set("state", b.state);

    const response = c.redirect(redirectUrl.toString());
    response.headers.append(
      "Set-Cookie",
      humanSessionCookie(humanToken, humanSessionMaxAge(expiresAt))
    );
    return response;
  })

  .post("/oauth/token", async (c) => {
    const { grant_type, client_id, code, code_verifier, redirect_uri, refresh_token, resource } =
      await readBody(c);

    if (grant_type === "authorization_code") {
      if (!code || !code_verifier) {
        return c.json(
          { error: "invalid_request", error_description: "code and code_verifier are required" },
          400
        );
      }
      try {
        return c.json(
          await oauthService.exchangeCodeForToken({
            clientId: client_id,
            code,
            codeVerifier: code_verifier,
            redirectUri: redirect_uri,
            resource,
          })
        );
      } catch (err: any) {
        return c.json({ error: "invalid_grant", error_description: err.message }, 400);
      }
    }

    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        return c.json(
          { error: "invalid_request", error_description: "refresh_token is required" },
          400
        );
      }
      try {
        return c.json(
          await oauthService.refreshAccessToken({
            clientId: client_id,
            refreshToken: refresh_token,
            resource,
          })
        );
      } catch (err: any) {
        return c.json({ error: "invalid_grant", error_description: err.message }, 400);
      }
    }

    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Supported grant_types: authorization_code, refresh_token",
      },
      400
    );
  })

  .post("/oauth/revoke", async (c) => {
    const { token, client_id } = await readBody(c);
    if (token) await oauthService.revokeToken({ token, clientId: client_id });
    return c.json({ success: true });
  });
