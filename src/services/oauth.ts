import { db, schema } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { config } from "../config";
import { authService } from "./auth";
import { auditService } from "./audit";
import type { PermissionScope } from "../types/auth";
import { ALL_SCOPES } from "../types/auth";
import { AuthenticationError, AuthorizationError } from "../utils/errors";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

export interface OAuthClientMetadata {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  scope?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

export interface OAuthClient {
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  allowedScopes: string[];
  isPublic: boolean;
}

export class OAuthService {
  /**
   * Resolves client metadata via Client ID Metadata Document (CIMD) or database.
   * If clientId is an HTTPS URL, resolves CIMD according to ChatGPT / MCP spec.
   */
  async validateClient(clientId: string, redirectUri: string): Promise<OAuthClient> {
    // 1. Check database for pre-registered or cached clients
    const [client] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId))
      .limit(1);

    if (client) {
      const uriMatch = (client.redirectUris as string[]).some(
        (uri: string) => uri === redirectUri || redirectUri.startsWith(uri)
      );
      if (!uriMatch) {
        throw new AuthorizationError(`Invalid redirect_uri '${redirectUri}' for client '${clientId}'`);
      }
      return {
        id: client.id,
        clientId: client.clientId,
        clientName: client.clientName,
        redirectUris: client.redirectUris as string[],
        allowedScopes: client.allowedScopes as string[],
        isPublic: Boolean(client.isPublic),
      };
    }

    // 2. CIMD (Client ID Metadata Document): Client ID is an HTTPS URL
    if (clientId.startsWith("https://")) {
      try {
        const timeoutSignal = AbortSignal.timeout(5000);
        const resp = await fetch(clientId, {
          headers: { Accept: "application/json" },
          signal: timeoutSignal,
        });

        if (resp.ok) {
          const doc = (await resp.json()) as OAuthClientMetadata;
          if (doc.redirect_uris && Array.isArray(doc.redirect_uris)) {
            const uriMatch = doc.redirect_uris.some(
              (uri: string) => uri === redirectUri || redirectUri.startsWith(uri)
            );
            if (!uriMatch) {
              throw new AuthorizationError(`Redirect URI '${redirectUri}' not permitted by CIMD at '${clientId}'`);
            }

            // Cache client registration
            await this.registerClient({
              clientId,
              clientName: doc.client_name || "CIMD Client",
              redirectUris: doc.redirect_uris,
              allowedScopes: ALL_SCOPES,
              isPublic: true,
            });

            return {
              id: clientId,
              clientId,
              clientName: doc.client_name || "CIMD Client",
              redirectUris: doc.redirect_uris,
              allowedScopes: ALL_SCOPES,
              isPublic: true,
            };
          }
        }
      } catch (err: any) {
        if (err instanceof AuthorizationError) throw err;
        // Fall through to default handlers
      }
    }

    // 3. Known ChatGPT / OpenAI / Localhost Developer Mode Redirects
    const isKnownMcpClient =
      redirectUri.startsWith("https://chat.openai.com") ||
      redirectUri.startsWith("https://chatgpt.com") ||
      redirectUri.startsWith("http://localhost");

    if (isKnownMcpClient) {
      await this.registerClient({
        clientId,
        clientName: "ChatGPT Developer MCP",
        redirectUris: [
          "https://chat.openai.com/aip/plugin-oauth/callback",
          "https://chatgpt.com/aip/plugin-oauth/callback",
          redirectUri,
        ],
        isPublic: true,
      });

      return {
        id: clientId,
        clientId,
        clientName: "ChatGPT Developer MCP",
        redirectUris: [
          "https://chat.openai.com/aip/plugin-oauth/callback",
          "https://chatgpt.com/aip/plugin-oauth/callback",
          redirectUri,
        ],
        allowedScopes: ALL_SCOPES,
        isPublic: true,
      };
    }

    throw new AuthenticationError(`Unknown OAuth client_id: ${clientId}`);
  }

  /**
   * Registers an OAuth client (DCR - RFC 7591)
   */
  async registerClient(params: {
    clientId?: string;
    clientSecret?: string;
    clientName: string;
    redirectUris: string[];
    allowedScopes?: string[];
    isPublic?: boolean;
    tenantId?: string;
  }): Promise<{ clientId: string; clientSecret?: string }> {
    const clientId = params.clientId || `mw_client_${nanoid(20)}`;
    const clientSecret = params.isPublic ? undefined : params.clientSecret || `mw_sec_${nanoid(32)}`;
    const secretHash = clientSecret ? createHash("sha256").update(clientSecret).digest("hex") : null;

    const [existing] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.oauthClients)
        .set({
          clientName: params.clientName,
          redirectUris: params.redirectUris,
          allowedScopes: params.allowedScopes || ALL_SCOPES,
          isPublic: params.isPublic || false,
          clientSecretHash: secretHash || existing.clientSecretHash,
        })
        .where(eq(schema.oauthClients.id, existing.id));
    } else {
      await db.insert(schema.oauthClients).values({
        id: nanoid(),
        tenantId: params.tenantId,
        clientId,
        clientSecretHash: secretHash,
        clientName: params.clientName,
        redirectUris: params.redirectUris,
        allowedScopes: params.allowedScopes || ALL_SCOPES,
        isPublic: params.isPublic || false,
        createdAt: new Date(),
      });
    }

    return { clientId, clientSecret };
  }

  /**
   * Issues an ephemeral single-use authorization code with PKCE challenge & RFC 8707 resource binding
   */
  async createAuthorizationCode(params: {
    clientId: string;
    tenantId: string;
    userId: string;
    scopes: PermissionScope[];
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod?: string;
    resource?: string;
  }): Promise<string> {
    const code = `mw_code_${nanoid(32)}`;
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

    await db.insert(schema.oauthCodes).values({
      id: nanoid(),
      codeHash,
      clientId: params.clientId,
      tenantId: params.tenantId,
      userId: params.userId,
      scopes: params.scopes,
      resource: params.resource || config.APP_BASE_URL,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod || "S256",
      expiresAt,
      createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: params.tenantId,
      userId: params.userId,
      action: "OAUTH_AUTHORIZE_CODE_ISSUED",
      details: { clientId: params.clientId, resource: params.resource, scopesCount: params.scopes.length },
    });

    return code;
  }

  private verifyPkceS256(verifier: string, challenge: string): boolean {
    const hash = createHash("sha256").update(verifier).digest("base64url");
    return hash === challenge;
  }

  /**
   * Exchanges an authorization code + PKCE verifier for short-lived access token + rotating refresh token
   */
  async exchangeCodeForToken(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }) {
    const codeHash = createHash("sha256").update(params.code).digest("hex");

    const [record] = await db
      .select()
      .from(schema.oauthCodes)
      .where(eq(schema.oauthCodes.codeHash, codeHash))
      .limit(1);

    if (!record) {
      throw new AuthenticationError("Invalid authorization code");
    }

    if (record.usedAt) {
      await auditService.logEvent({
        tenantId: record.tenantId,
        userId: record.userId,
        action: "OAUTH_REPLAY_ATTACK_DETECTED",
        status: "failure",
        details: { codeHash },
      });
      throw new AuthenticationError("Authorization code has already been used");
    }

    if (record.expiresAt < new Date()) {
      throw new AuthenticationError("Authorization code has expired");
    }

    if (record.clientId !== params.clientId) {
      throw new AuthenticationError("Client ID mismatch for authorization code");
    }

    // Verify PKCE
    if (!this.verifyPkceS256(params.codeVerifier, record.codeChallenge)) {
      throw new AuthenticationError("Invalid PKCE code_verifier");
    }

    // Mark code as used atomically
    await db
      .update(schema.oauthCodes)
      .set({ usedAt: new Date() })
      .where(eq(schema.oauthCodes.id, record.id));

    // Fetch user details
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, record.userId))
      .limit(1);

    if (!user) {
      throw new AuthenticationError("User not found for authorization code");
    }

    const boundResource = params.resource || record.resource || config.APP_BASE_URL;

    // Issue short-lived access token (1 hour = 3600 seconds)
    const tokenResult = await authService.createToken(
      {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      record.scopes as PermissionScope[],
      "1h"
    );

    // Issue rotating refresh token (30 days TTL)
    const refreshToken = `mw_rt_${nanoid(40)}`;
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(schema.oauthTokens).values({
      id: nanoid(),
      tokenHash: refreshHash,
      tokenType: "refresh_token",
      clientId: params.clientId,
      tenantId: user.tenantId,
      userId: user.id,
      scopes: record.scopes,
      resource: boundResource,
      expiresAt: refreshExpiresAt,
      createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: user.tenantId,
      userId: user.id,
      action: "OAUTH_TOKEN_EXCHANGED",
      details: { clientId: params.clientId, resource: boundResource },
    });

    return {
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 3600, // 1 hour
      refresh_token: refreshToken,
      scope: (record.scopes as string[]).join(" "),
      tenant_id: user.tenantId,
      user_id: user.id,
    };
  }

  /**
   * Refreshes an access token with automatic Refresh Token Rotation & Reuse Detection
   */
  async refreshAccessToken(params: {
    clientId: string;
    refreshToken: string;
    resource?: string;
  }) {
    const oldHash = createHash("sha256").update(params.refreshToken).digest("hex");

    const [tokenRecord] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.tokenHash, oldHash))
      .limit(1);

    if (!tokenRecord || tokenRecord.tokenType !== "refresh_token") {
      throw new AuthenticationError("Invalid refresh token");
    }

    // Refresh Token Reuse Detection (Replay attack prevention)
    if (tokenRecord.usedAt || tokenRecord.revokedAt) {
      // Revoke all tokens for this client/user session as a security precaution
      await db
        .update(schema.oauthTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.oauthTokens.tenantId, tokenRecord.tenantId),
            eq(schema.oauthTokens.userId, tokenRecord.userId),
            eq(schema.oauthTokens.clientId, params.clientId)
          )
        );

      await auditService.logEvent({
        tenantId: tokenRecord.tenantId,
        userId: tokenRecord.userId,
        action: "OAUTH_REPLAY_ATTACK_DETECTED",
        status: "failure",
        details: { reason: "Refresh token reuse attempt detected", tokenHash: oldHash },
      });

      throw new AuthenticationError("Refresh token was previously used or revoked. Re-authentication required.");
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new AuthenticationError("Refresh token has expired");
    }

    if (tokenRecord.clientId !== params.clientId) {
      throw new AuthenticationError("Client ID mismatch for refresh token");
    }

    const now = new Date();

    // Mark current refresh token as used atomically
    await db
      .update(schema.oauthTokens)
      .set({ usedAt: now, revokedAt: now })
      .where(eq(schema.oauthTokens.id, tokenRecord.id));

    // Fetch user details
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, tokenRecord.userId))
      .limit(1);

    if (!user) {
      throw new AuthenticationError("User account no longer exists");
    }

    const boundResource = params.resource || tokenRecord.resource || config.APP_BASE_URL;

    // Issue new 1-hour access token
    const tokenResult = await authService.createToken(
      {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      tokenRecord.scopes as PermissionScope[],
      "1h"
    );

    // Issue NEW rotated refresh token (30 days)
    const newRefreshToken = `mw_rt_${nanoid(40)}`;
    const newRefreshHash = createHash("sha256").update(newRefreshToken).digest("hex");
    const newRefreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(schema.oauthTokens).values({
      id: nanoid(),
      tokenHash: newRefreshHash,
      tokenType: "refresh_token",
      clientId: params.clientId,
      tenantId: user.tenantId,
      userId: user.id,
      scopes: tokenRecord.scopes,
      resource: boundResource,
      parentTokenHash: oldHash,
      expiresAt: newRefreshExpiresAt,
      createdAt: now,
    });

    await auditService.logEvent({
      tenantId: user.tenantId,
      userId: user.id,
      action: "OAUTH_TOKEN_EXCHANGED",
      details: { grant_type: "refresh_token", clientId: params.clientId },
    });

    return {
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 3600, // 1 hour
      refresh_token: newRefreshToken,
      scope: (tokenRecord.scopes as string[]).join(" "),
      tenant_id: user.tenantId,
      user_id: user.id,
    };
  }

  /**
   * Revokes a token (RFC 7009)
   */
  async revokeToken(params: { token: string; clientId?: string }): Promise<void> {
    const tokenHash = createHash("sha256").update(params.token).digest("hex");
    const now = new Date();

    // Revoke from oauthTokens
    await db
      .update(schema.oauthTokens)
      .set({ revokedAt: now })
      .where(eq(schema.oauthTokens.tokenHash, tokenHash));

    // Also revoke session if present
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash));
  }
}

export const oauthService = new OAuthService();
