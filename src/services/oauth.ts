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

function assertResource(resource?: string | null): string {
  const bound = resource || config.APP_BASE_URL;
  if (bound !== config.APP_BASE_URL) {
    throw new AuthenticationError(`Invalid OAuth resource '${bound}'`);
  }
  return bound;
}

export class OAuthService {
  async validateClient(clientId: string, redirectUri: string): Promise<OAuthClient> {
    const [client] = await db.select().from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId)).limit(1);

    if (client) {
      const uriMatch = (client.redirectUris as string[]).some((uri) => uri === redirectUri);
      if (!uriMatch) throw new AuthorizationError(`Invalid redirect_uri '${redirectUri}' for client '${clientId}'`);
      return {
        id: client.id,
        clientId: client.clientId,
        clientName: client.clientName,
        redirectUris: client.redirectUris as string[],
        allowedScopes: client.allowedScopes as string[],
        isPublic: Boolean(client.isPublic),
      };
    }

    // Client ID Metadata Document (CIMD). Exact redirect URI matching is mandatory.
    if (clientId.startsWith("https://")) {
      try {
        const resp = await fetch(clientId, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const doc = (await resp.json()) as OAuthClientMetadata;
          if (Array.isArray(doc.redirect_uris) && doc.redirect_uris.includes(redirectUri)) {
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
          if (Array.isArray(doc.redirect_uris)) {
            throw new AuthorizationError(`Redirect URI '${redirectUri}' not permitted by CIMD at '${clientId}'`);
          }
        }
      } catch (err: any) {
        if (err instanceof AuthorizationError) throw err;
      }
    }

    // Compatibility for known ChatGPT/local developer callbacks. The exact URI seen is registered.
    const parsed = new URL(redirectUri);
    const knownHost = parsed.protocol === "https:" && (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com");
    const localHost = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (knownHost || localHost) {
      await this.registerClient({
        clientId,
        clientName: "ChatGPT Developer MCP",
        redirectUris: [redirectUri],
        allowedScopes: ALL_SCOPES,
        isPublic: true,
      });
      return {
        id: clientId,
        clientId,
        clientName: "ChatGPT Developer MCP",
        redirectUris: [redirectUri],
        allowedScopes: ALL_SCOPES,
        isPublic: true,
      };
    }

    throw new AuthenticationError(`Unknown OAuth client_id: ${clientId}`);
  }

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

    const [existing] = await db.select().from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId)).limit(1);

    if (existing) {
      await db.update(schema.oauthClients).set({
        clientName: params.clientName,
        redirectUris: params.redirectUris,
        allowedScopes: params.allowedScopes || ALL_SCOPES,
        isPublic: params.isPublic || false,
        clientSecretHash: secretHash || existing.clientSecretHash,
      }).where(eq(schema.oauthClients.id, existing.id));
    } else {
      await db.insert(schema.oauthClients).values({
        id: nanoid(), tenantId: params.tenantId, clientId, clientSecretHash: secretHash,
        clientName: params.clientName, redirectUris: params.redirectUris,
        allowedScopes: params.allowedScopes || ALL_SCOPES, isPublic: params.isPublic || false,
        createdAt: new Date(),
      });
    }
    return { clientId, clientSecret };
  }

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
    if ((params.codeChallengeMethod || "S256") !== "S256") {
      throw new AuthenticationError("Only PKCE S256 is supported");
    }
    const resource = assertResource(params.resource);
    const code = `mw_code_${nanoid(32)}`;
    const codeHash = createHash("sha256").update(code).digest("hex");

    await db.insert(schema.oauthCodes).values({
      id: nanoid(), codeHash, clientId: params.clientId, tenantId: params.tenantId, userId: params.userId,
      scopes: params.scopes, resource, redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge, codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: params.tenantId,
      userId: params.userId,
      action: "OAUTH_AUTHORIZE_CODE_ISSUED",
      details: { clientId: params.clientId, resource, scopesCount: params.scopes.length },
    });
    return code;
  }

  private verifyPkceS256(verifier: string, challenge: string): boolean {
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
  }

  async exchangeCodeForToken(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }) {
    const codeHash = createHash("sha256").update(params.code).digest("hex");
    const [record] = await db.select().from(schema.oauthCodes).where(eq(schema.oauthCodes.codeHash, codeHash)).limit(1);
    if (!record) throw new AuthenticationError("Invalid authorization code");

    if (record.usedAt) {
      await auditService.logEvent({
        tenantId: record.tenantId, userId: record.userId, action: "OAUTH_REPLAY_ATTACK_DETECTED",
        status: "failure", details: { codeHash },
      });
      throw new AuthenticationError("Authorization code has already been used");
    }
    if (record.expiresAt < new Date()) throw new AuthenticationError("Authorization code has expired");
    if (record.clientId !== params.clientId) throw new AuthenticationError("Client ID mismatch for authorization code");
    if (record.redirectUri !== params.redirectUri) throw new AuthenticationError("Redirect URI mismatch for authorization code");
    const boundResource = assertResource(params.resource || record.resource);
    if (record.resource && record.resource !== boundResource) throw new AuthenticationError("Resource mismatch for authorization code");
    if (!this.verifyPkceS256(params.codeVerifier, record.codeChallenge)) throw new AuthenticationError("Invalid PKCE code_verifier");

    // Single-use claim. If a concurrent exchange already consumed it, returning() is empty.
    const [claimed] = await db.update(schema.oauthCodes).set({ usedAt: new Date() })
      .where(and(eq(schema.oauthCodes.id, record.id), isNull(schema.oauthCodes.usedAt))).returning();
    if (!claimed) throw new AuthenticationError("Authorization code has already been used");

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, record.userId)).limit(1);
    if (!user) throw new AuthenticationError("User not found for authorization code");

    const tokenResult = await authService.createToken({
      id: user.id, tenantId: user.tenantId, email: user.email, displayName: user.displayName, role: user.role,
    }, record.scopes as PermissionScope[], "1h");

    const refreshToken = `mw_rt_${nanoid(40)}`;
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");
    await db.insert(schema.oauthTokens).values({
      id: nanoid(), tokenHash: refreshHash, tokenType: "refresh_token", clientId: params.clientId,
      tenantId: user.tenantId, userId: user.id, scopes: record.scopes, resource: boundResource,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: user.tenantId, userId: user.id, action: "OAUTH_TOKEN_EXCHANGED",
      details: { clientId: params.clientId, resource: boundResource },
    });

    return {
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: (record.scopes as string[]).join(" "),
    };
  }

  async refreshAccessToken(params: { clientId: string; refreshToken: string; resource?: string }) {
    const oldHash = createHash("sha256").update(params.refreshToken).digest("hex");
    const [tokenRecord] = await db.select().from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.tokenHash, oldHash)).limit(1);

    if (!tokenRecord || tokenRecord.tokenType !== "refresh_token") throw new AuthenticationError("Invalid refresh token");
    if (tokenRecord.usedAt || tokenRecord.revokedAt) {
      await db.update(schema.oauthTokens).set({ revokedAt: new Date() }).where(and(
        eq(schema.oauthTokens.tenantId, tokenRecord.tenantId),
        eq(schema.oauthTokens.userId, tokenRecord.userId),
        eq(schema.oauthTokens.clientId, params.clientId)
      ));
      await auditService.logEvent({
        tenantId: tokenRecord.tenantId, userId: tokenRecord.userId, action: "OAUTH_REPLAY_ATTACK_DETECTED",
        status: "failure", details: { reason: "Refresh token reuse attempt detected", tokenHash: oldHash },
      });
      throw new AuthenticationError("Refresh token was previously used or revoked. Re-authentication required.");
    }
    if (tokenRecord.expiresAt < new Date()) throw new AuthenticationError("Refresh token has expired");
    if (tokenRecord.clientId !== params.clientId) throw new AuthenticationError("Client ID mismatch for refresh token");

    const boundResource = assertResource(params.resource || tokenRecord.resource);
    if (tokenRecord.resource && tokenRecord.resource !== boundResource) throw new AuthenticationError("Resource mismatch for refresh token");

    const now = new Date();
    const [claimed] = await db.update(schema.oauthTokens).set({ usedAt: now, revokedAt: now })
      .where(and(eq(schema.oauthTokens.id, tokenRecord.id), isNull(schema.oauthTokens.usedAt), isNull(schema.oauthTokens.revokedAt))).returning();
    if (!claimed) throw new AuthenticationError("Refresh token was already consumed");

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, tokenRecord.userId)).limit(1);
    if (!user) throw new AuthenticationError("User account no longer exists");

    const tokenResult = await authService.createToken({
      id: user.id, tenantId: user.tenantId, email: user.email, displayName: user.displayName, role: user.role,
    }, tokenRecord.scopes as PermissionScope[], "1h");

    const newRefreshToken = `mw_rt_${nanoid(40)}`;
    const newRefreshHash = createHash("sha256").update(newRefreshToken).digest("hex");
    await db.insert(schema.oauthTokens).values({
      id: nanoid(), tokenHash: newRefreshHash, tokenType: "refresh_token", clientId: params.clientId,
      tenantId: user.tenantId, userId: user.id, scopes: tokenRecord.scopes, resource: boundResource,
      parentTokenHash: oldHash, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), createdAt: now,
    });

    await auditService.logEvent({
      tenantId: user.tenantId, userId: user.id, action: "OAUTH_TOKEN_EXCHANGED",
      details: { grant_type: "refresh_token", clientId: params.clientId, resource: boundResource },
    });

    return {
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: (tokenRecord.scopes as string[]).join(" "),
    };
  }

  async revokeToken(params: { token: string; clientId?: string }): Promise<void> {
    const tokenHash = createHash("sha256").update(params.token).digest("hex");
    await db.update(schema.oauthTokens).set({ revokedAt: new Date() }).where(eq(schema.oauthTokens.tokenHash, tokenHash));
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
  }
}

export const oauthService = new OAuthService();
