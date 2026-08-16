import { Elysia, t } from "elysia";
import { oauthService } from "../../services/oauth";
import { authService } from "../../services/auth";
import { ALL_SCOPES, type PermissionScope } from "../../types/auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export const oauthRoutes = new Elysia({ aot: false })
  // 1. RFC 8414 OAuth 2.0 / 2.1 Authorization Server Metadata
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

  // 2. RFC 9728 OAuth 2.0 Protected Resource Metadata
  .get("/.well-known/oauth-protected-resource", () => ({
    resource: config.APP_BASE_URL,
    authorization_servers: [config.APP_BASE_URL],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.APP_BASE_URL}/swagger`,
  }))

  // 3. Dynamic Client Registration (RFC 7591)
  .post(
    "/oauth/register",
    async ({ body, set }) => {
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
    },
    {
      body: t.Object({
        client_name: t.Optional(t.String()),
        redirect_uris: t.Array(t.String()),
        scope: t.Optional(t.String()),
        grant_types: t.Optional(t.Array(t.String())),
        token_endpoint_auth_method: t.Optional(t.String()),
      }),
    }
  )

  // 4. Authorization Endpoint (GET)
  .get(
    "/oauth/authorize",
    async ({ query, set }) => {
      const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method, scope, resource, user_email } = query;

      if (response_type !== "code") {
        set.status = 400;
        return { error: "unsupported_response_type", error_description: "Only response_type=code is supported in OAuth 2.1" };
      }

      if (!code_challenge) {
        set.status = 400;
        return { error: "invalid_request", error_description: "PKCE code_challenge is mandatory in OAuth 2.1" };
      }

      try {
        await oauthService.validateClient(client_id, redirect_uri);
      } catch (err: any) {
        set.status = 400;
        return { error: "invalid_client", error_description: err.message };
      }

      // If user_email is provided (e.g. from session or quick authorize), issue code directly
      if (user_email) {
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, user_email.toLowerCase()))
          .limit(1);

        if (user) {
          const requestedScopes = scope ? (scope.split(" ") as PermissionScope[]) : ALL_SCOPES;
          const code = await oauthService.createAuthorizationCode({
            clientId: client_id,
            tenantId: user.tenantId,
            userId: user.id,
            scopes: requestedScopes,
            resource,
            redirectUri: redirect_uri,
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge_method || "S256",
          });

          const redirectUrl = new URL(redirect_uri);
          redirectUrl.searchParams.set("code", code);
          if (state) redirectUrl.searchParams.set("state", state);

          set.redirect = redirectUrl.toString();
          return;
        }
      }

      // Return JSON authorization consent details for API clients / developer mode
      return {
        action: "consent_required",
        client_id,
        redirect_uri,
        state,
        resource: resource || config.APP_BASE_URL,
        code_challenge,
        scopes: scope ? scope.split(" ") : ALL_SCOPES,
        message: "Authenticate with POST /oauth/authorize to complete authorization",
      };
    },
    {
      query: t.Object({
        client_id: t.String(),
        redirect_uri: t.String(),
        response_type: t.String(),
        state: t.Optional(t.String()),
        code_challenge: t.String(),
        code_challenge_method: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        resource: t.Optional(t.String()),
        user_email: t.Optional(t.String()),
      }),
    }
  )

  // 5. Authorization Endpoint (POST - Completes human user consent/login)
  .post(
    "/oauth/authorize",
    async ({ body, set }) => {
      const { client_id, redirect_uri, code_challenge, code_challenge_method, email, state, scope, resource } = body;

      try {
        await oauthService.validateClient(client_id, redirect_uri);
      } catch (err: any) {
        set.status = 400;
        return { error: "invalid_client", error_description: err.message };
      }

      const normalizedEmail = email.toLowerCase();
      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail))
        .limit(1);

      let tenantId: string;
      let userId: string;

      if (!user) {
        // Auto-provision workspace and owner for new user
        const created = await authService.createTenantAndOwner({
          tenantName: `${email.split("@")[0]}'s Workspace`,
          slug: `ws-${nanoid(8)}`,
          ownerEmail: normalizedEmail,
          ownerDisplayName: email.split("@")[0] || "User",
        });
        tenantId = created.tenantId;
        userId = created.userId;
      } else {
        tenantId = user.tenantId;
        userId = user.id;
      }

      const requestedScopes = scope ? (scope.split(" ") as PermissionScope[]) : ALL_SCOPES;

      const code = await oauthService.createAuthorizationCode({
        clientId: client_id,
        tenantId,
        userId,
        scopes: requestedScopes,
        resource,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      return {
        redirect_to: redirectUrl.toString(),
        code,
      };
    },
    {
      body: t.Object({
        client_id: t.String(),
        redirect_uri: t.String(),
        code_challenge: t.String(),
        code_challenge_method: t.Optional(t.String()),
        email: t.String(),
        state: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        resource: t.Optional(t.String()),
      }),
    }
  )

  // 6. Token Endpoint (POST /oauth/token) - Authorization Code & Rotating Refresh Token
  .post(
    "/oauth/token",
    async ({ body, set }) => {
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
          return await oauthService.refreshAccessToken({
            clientId: client_id,
            refreshToken: refresh_token,
            resource,
          });
        } catch (err: any) {
          set.status = 400;
          return { error: "invalid_grant", error_description: err.message };
        }
      }

      set.status = 400;
      return { error: "unsupported_grant_type", error_description: "Supported grant_types: authorization_code, refresh_token" };
    },
    {
      body: t.Object({
        grant_type: t.String(),
        client_id: t.String(),
        code: t.Optional(t.String()),
        code_verifier: t.Optional(t.String()),
        redirect_uri: t.Optional(t.String()),
        refresh_token: t.Optional(t.String()),
        resource: t.Optional(t.String()),
      }),
    }
  )

  // 7. Revocation Endpoint (POST /oauth/revoke - RFC 7009)
  .post(
    "/oauth/revoke",
    async ({ body }) => {
      const { token, client_id } = body as any;
      if (token) {
        await oauthService.revokeToken({ token, clientId: client_id });
      }
      return { success: true };
    },
    {
      body: t.Object({
        token: t.String(),
        client_id: t.Optional(t.String()),
      }),
    }
  );
