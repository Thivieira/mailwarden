import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { config } from "../config";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import { AuthenticationError, ConfigurationError, ProviderError } from "../utils/errors";
import { encryptionService } from "./encryption";
import { auditService } from "./audit";

export type ProviderOAuthName = "gmail" | "outlook";
export type ProviderMode = "readonly" | "actions" | "draft" | "full";

type ProviderState = {
  provider: ProviderOAuthName;
  tenantId: string;
  userId: string;
  mode: ProviderMode;
};

function stateSecret() {
  return new TextEncoder().encode(config.AUTH_SECRET);
}

function callbackUrl(provider: ProviderOAuthName): string {
  if (provider === "gmail") {
    return config.GOOGLE_REDIRECT_URI || `${config.APP_BASE_URL}/auth/callback/google`;
  }
  return config.MICROSOFT_REDIRECT_URI || `${config.APP_BASE_URL}/auth/callback/microsoft`;
}

const googleScopeMap: Record<ProviderMode, string[]> = {
  readonly: ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email", "profile"],
  actions: ["https://www.googleapis.com/auth/gmail.modify", "openid", "email", "profile"],
  draft: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "openid", "email", "profile"],
  full: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "openid", "email", "profile"],
};

const microsoftScopeMap: Record<ProviderMode, string[]> = {
  readonly: ["Mail.Read", "User.Read", "offline_access"],
  actions: ["Mail.ReadWrite", "User.Read", "offline_access"],
  draft: ["Mail.ReadWrite", "User.Read", "offline_access"],
  full: ["Mail.ReadWrite", "Mail.Send", "User.Read", "offline_access"],
};

export class ProviderOAuthService {
  async createState(principal: AuthPrincipal, provider: ProviderOAuthName, mode: ProviderMode): Promise<string> {
    return new SignJWT({
      provider,
      tenantId: principal.tenantId,
      userId: principal.userId,
      mode,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .setAudience("mailwarden-provider-oauth")
      .sign(stateSecret());
  }

  async verifyState(raw: string, expectedProvider: ProviderOAuthName): Promise<ProviderState> {
    try {
      const { payload } = await jwtVerify(raw, stateSecret(), { audience: "mailwarden-provider-oauth" });
      if (payload.provider !== expectedProvider || !payload.tenantId || !payload.userId) {
        throw new Error("Provider OAuth state does not match callback");
      }
      return {
        provider: expectedProvider,
        tenantId: String(payload.tenantId),
        userId: String(payload.userId),
        mode: (payload.mode as ProviderMode) || "readonly",
      };
    } catch (error: any) {
      throw new AuthenticationError(`Invalid or expired provider OAuth state: ${error.message}`);
    }
  }

  async buildAuthorizationUrl(principal: AuthPrincipal, provider: ProviderOAuthName, mode: ProviderMode = "readonly") {
    const state = await this.createState(principal, provider, mode);

    if (provider === "gmail") {
      if (!config.GOOGLE_CLIENT_ID) throw new ConfigurationError("GOOGLE_CLIENT_ID is not configured");
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
      url.searchParams.set("redirect_uri", callbackUrl("gmail"));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("scope", googleScopeMap[mode].join(" "));
      url.searchParams.set("state", state);
      return { authUrl: url.toString(), requestedScopes: googleScopeMap[mode], mode };
    }

    if (!config.MICROSOFT_CLIENT_ID) throw new ConfigurationError("MICROSOFT_CLIENT_ID is not configured");
    const url = new URL(`https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", config.MICROSOFT_CLIENT_ID);
    url.searchParams.set("redirect_uri", callbackUrl("outlook"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", microsoftScopeMap[mode].join(" "));
    url.searchParams.set("state", state);
    return { authUrl: url.toString(), requestedScopes: microsoftScopeMap[mode], mode };
  }

  async completeGoogleCallback(code: string, stateToken: string) {
    const state = await this.verifyState(stateToken, "gmail");
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new ConfigurationError("Google OAuth credentials are not configured");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl("gmail"),
      }),
    });
    if (!tokenResponse.ok) throw new ProviderError(`Google token exchange failed: ${await tokenResponse.text()}`, "gmail");
    const tokens = await tokenResponse.json() as any;

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileResponse.ok) throw new ProviderError(`Google profile lookup failed: ${await profileResponse.text()}`, "gmail");
    const profile = await profileResponse.json() as any;

    return this.persistConnection(state, {
      email: String(profile.email || "").toLowerCase(),
      displayName: profile.name || profile.email,
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        scope: tokens.scope,
        mode: state.mode,
      },
    });
  }

  async completeMicrosoftCallback(code: string, stateToken: string) {
    const state = await this.verifyState(stateToken, "outlook");
    if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
      throw new ConfigurationError("Microsoft OAuth credentials are not configured");
    }

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.MICROSOFT_CLIENT_ID,
        client_secret: config.MICROSOFT_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl("outlook"),
        scope: microsoftScopeMap[state.mode].join(" "),
      }),
    });
    if (!tokenResponse.ok) throw new ProviderError(`Microsoft token exchange failed: ${await tokenResponse.text()}`, "outlook");
    const tokens = await tokenResponse.json() as any;

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileResponse.ok) throw new ProviderError(`Microsoft profile lookup failed: ${await profileResponse.text()}`, "outlook");
    const profile = await profileResponse.json() as any;
    const email = String(profile.mail || profile.userPrincipalName || "").toLowerCase();

    return this.persistConnection(state, {
      email,
      displayName: profile.displayName || email,
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        scope: tokens.scope,
        mode: state.mode,
      },
    });
  }

  private async persistConnection(
    state: ProviderState,
    input: { email: string; displayName: string; credentials: Record<string, any> }
  ) {
    if (!input.email || !input.credentials.refreshToken) {
      throw new ProviderError("Provider did not return a usable email address and refresh token", state.provider);
    }

    const now = new Date();
    const [user] = await db.select().from(schema.users).where(
      and(eq(schema.users.id, state.userId), eq(schema.users.tenantId, state.tenantId))
    ).limit(1);
    if (!user) throw new AuthenticationError("Provider callback user no longer exists");

    let [account] = await db.select().from(schema.emailAccounts).where(
      and(
        eq(schema.emailAccounts.tenantId, state.tenantId),
        eq(schema.emailAccounts.userId, state.userId),
        eq(schema.emailAccounts.emailAddress, input.email)
      )
    ).limit(1);

    const provider = state.provider;
    if (!account) {
      const accountId = nanoid();
      await db.insert(schema.emailAccounts).values({
        id: accountId,
        tenantId: state.tenantId,
        userId: state.userId,
        provider,
        displayName: input.displayName || input.email,
        emailAddress: input.email,
        status: "connected",
        priorityRole: "primary_work",
        createdAt: now,
        updatedAt: now,
      });
      [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, accountId)).limit(1);
    } else {
      await db.update(schema.emailAccounts).set({
        provider,
        displayName: input.displayName || input.email,
        status: "connected",
        errorMessage: null,
        updatedAt: now,
      }).where(eq(schema.emailAccounts.id, account.id));
    }

    const encryptedCredentials = encryptionService.encryptJson(input.credentials, {
      tenantId: state.tenantId,
      userId: state.userId,
    });

    const [existingConnection] = await db.select().from(schema.providerConnections)
      .where(eq(schema.providerConnections.accountId, account!.id)).limit(1);
    if (existingConnection) {
      await db.update(schema.providerConnections).set({
        provider,
        encryptedCredentials,
        keyVersion: encryptedCredentials.keyVersion,
        updatedAt: now,
      }).where(eq(schema.providerConnections.id, existingConnection.id));
    } else {
      await db.insert(schema.providerConnections).values({
        id: nanoid(),
        tenantId: state.tenantId,
        userId: state.userId,
        accountId: account!.id,
        provider,
        encryptedCredentials,
        keyVersion: encryptedCredentials.keyVersion,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [identity] = await db.select().from(schema.emailIdentities).where(
      and(
        eq(schema.emailIdentities.tenantId, state.tenantId),
        eq(schema.emailIdentities.accountId, account!.id),
        eq(schema.emailIdentities.email, input.email)
      )
    ).limit(1);
    if (!identity) {
      await db.insert(schema.emailIdentities).values({
        id: nanoid(),
        tenantId: state.tenantId,
        userId: state.userId,
        accountId: account!.id,
        email: input.email,
        displayName: input.displayName,
        canSend: state.mode === "full" || state.mode === "draft",
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: state.tenantId,
      userId: state.userId,
      action: "PROVIDER_CONNECTED",
      resourceType: "account",
      resourceId: account!.id,
      details: { provider, emailAddress: input.email, mode: state.mode },
    });

    return { accountId: account!.id, provider, emailAddress: input.email, mode: state.mode };
  }
}

export const providerOAuthService = new ProviderOAuthService();
