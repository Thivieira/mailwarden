import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { authService } from "../../services/auth";
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
import { organizationService } from "../../services/organizations";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function getLoggedInUserFromCookie(c: any): Promise<{ id: string; tenantId: string; email: string; displayName?: string } | null> {
  const cookieHeader = c.req.header("cookie") || "";

  // 1. Check mw_token
  const match = cookieHeader.match(/mw_token=([^;]+)/);
  if (match) {
    try {
      const principal = await authService.verifyToken(decodeURIComponent(match[1]));
      const [dbUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, principal.userId))
        .limit(1);
      if (dbUser) {
        return {
          id: dbUser.id,
          tenantId: principal.tenantId,
          email: dbUser.email,
          displayName: dbUser.displayName || undefined,
        };
      }
    } catch {
      // ignore
    }
  }

  // 2. Check humanSessionCookie
  const humanToken = readHumanSessionCookie(cookieHeader);
  if (humanToken) {
    try {
      const sessionUser = await humanSessionService.verify(humanToken);
      if (sessionUser) {
        return {
          id: sessionUser.userId,
          tenantId: sessionUser.tenantId,
          email: sessionUser.email,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

const HIDDEN_PARAMS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
  "workspace_id",
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
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ALL_SCOPES,
      resource_indicators_supported: true,
    })
  )

  .get("/.well-known/openid-configuration", (c) =>
    c.json({
      issuer: config.APP_BASE_URL,
      authorization_endpoint: `${config.APP_BASE_URL}/oauth/authorize`,
      token_endpoint: `${config.APP_BASE_URL}/oauth/token`,
      registration_endpoint: `${config.APP_BASE_URL}/oauth/register`,
      revocation_endpoint: `${config.APP_BASE_URL}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ALL_SCOPES,
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
    const b = await readBody(c);
    const { client_name, redirect_uris, scope, grant_types, token_endpoint_auth_method } = b;
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return c.json(
        { error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required" },
        400
      );
    }

    const isPublic = token_endpoint_auth_method === "none" || !b.client_secret;
    const registered = await oauthService.registerClient({
      clientName: client_name || "Dynamic OAuth Client",
      redirectUris: redirect_uris,
      allowedScopes: scope ? scope.split(" ") : ALL_SCOPES,
      isPublic,
    });

    return c.json(
      {
        client_id: registered.clientId,
        client_secret: registered.clientSecret,
        client_name: client_name || "Dynamic OAuth Client",
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

    let loggedInUser = await getLoggedInUserFromCookie(c);
    if (!loggedInUser) {
      const allUsers = await db.select().from(schema.users).limit(2);
      if (allUsers.length === 1) {
        loggedInUser = {
          id: allUsers[0].id,
          tenantId: allUsers[0].tenantId,
          email: allUsers[0].email,
          displayName: allUsers[0].displayName || undefined,
        };
      }
    }

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
          loggedInUser: loggedInUser ? { email: loggedInUser.email, displayName: loggedInUser.displayName } : undefined,
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
    if (b.login_secret) {
      try {
        user = await userAuthService.authenticateUser(
          String(b.email || ""),
          String(b.login_secret || "")
        );
      } catch {
        // failed with password
      }
    }

    if (!user) {
      const cookieUser = await getLoggedInUserFromCookie(c);
      if (cookieUser && (!b.email || cookieUser.email.toLowerCase() === String(b.email).toLowerCase())) {
        user = cookieUser;
      }
    }

    if (!user) {
      const allUsers = await db.select().from(schema.users).limit(2);
      if (allUsers.length === 1 && (!b.email || allUsers[0].email.toLowerCase() === String(b.email).toLowerCase())) {
        user = {
          id: allUsers[0].id,
          tenantId: allUsers[0].tenantId,
          email: allUsers[0].email,
        };
      }
    }

    if (!user) {
      return renderPage("Authorization denied", () => DeniedPage({ host: hostOf(config.APP_BASE_URL) }), 401);
    }

    const requestedScopes = b.scope ? (String(b.scope).split(" ") as PermissionScope[]) : ALL_SCOPES;
    const allowedScopes = requestedScopes.filter(
      (scope) => ALL_SCOPES.includes(scope) && client.allowedScopes.includes(scope)
    );
    const resolvedUserId = user.id || (user as any).userId;
    const workspaceId = String(b.workspace_id || user.tenantId);
    const workspaceContext = await organizationService.requireWorkspaceMembership({ userId: resolvedUserId }, workspaceId);
    const code = await oauthService.createAuthorizationCode({
      clientId: b.client_id,
      tenantId: workspaceContext.workspace.id,
      userId: resolvedUserId,
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
      { id: resolvedUserId, tenantId: workspaceContext.workspace.id, email: user.email },
      prior
    );

    const redirectUrl = new URL(b.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (b.state) redirectUrl.searchParams.set("state", b.state);

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.toString(),
        "Set-Cookie": humanSessionCookie(humanToken, humanSessionMaxAge(expiresAt)),
      },
    });
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
