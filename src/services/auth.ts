import { SignJWT, jwtVerify } from "jose";
import { db, schema } from "../db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { config } from "../config";
import type { AuthPrincipal, PermissionScope } from "../types/auth";
import { ALL_SCOPES } from "../types/auth";
import { AuthenticationError, AuthorizationError, TenantIsolationError } from "../utils/errors";
import { auditService } from "./audit";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { organizationService } from "./organizations";

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(config.AUTH_SECRET);
}

function expirationDate(expiresIn: string): Date {
  const match = /^(\d+)([mhd])$/.exec(expiresIn);
  if (!match) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + amount * multiplier);
}

type TenantOwnerBase = {
  tenantName: string;
  slug: string;
  ownerEmail: string;
  ownerDisplayName: string;
};

export class AuthService {
  async createToken(
    user: { id: string; tenantId: string; email: string; displayName: string; role?: "owner" | "admin" | "member" },
    scopes: PermissionScope[] = ALL_SCOPES,
    expiresIn = "30d"
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const context = await organizationService.requireWorkspaceMembership({ userId: user.id }, user.tenantId);
    const sessionId = nanoid();
    const expiresAt = expirationDate(expiresIn);

    const token = await new SignJWT({
      sub: user.id,
      tenantId: user.tenantId,
      workspaceId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: context.membership.role,
      scopes,
      sessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.APP_BASE_URL)
      .setAudience(config.APP_BASE_URL)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(getJwtSecret());

    const tokenHash = createHash("sha256").update(token).digest("hex");

    await db.insert(schema.sessions).values({
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash,
      scopes,
      expiresAt,
      createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: user.tenantId,
      userId: user.id,
      action: "AUTH_LOGIN",
      resourceType: "session",
      resourceId: sessionId,
      details: { scopesCount: scopes.length, audience: config.APP_BASE_URL },
    });

    return { token, sessionId, expiresAt };
  }

  async verifyToken(tokenInput: string): Promise<AuthPrincipal> {
    if (!tokenInput) throw new AuthenticationError("Authentication token is required");

    let cleanToken = tokenInput.trim();
    if (cleanToken.startsWith("Bearer ")) cleanToken = cleanToken.slice(7).trim();

    try {
      const { payload } = await jwtVerify(cleanToken, getJwtSecret(), {
        issuer: config.APP_BASE_URL,
        audience: config.APP_BASE_URL,
      });
      const userId = payload.sub as string;
      const tenantId = (payload.workspaceId || payload.tenantId) as string;
      const scopes = (payload.scopes as PermissionScope[]) || [];
      const sessionId = payload.sessionId as string | undefined;

      if (!userId || !tenantId) {
        throw new AuthenticationError("Invalid token payload: missing user or tenant identity");
      }

      const tokenHash = createHash("sha256").update(cleanToken).digest("hex");
      const [revokedRecord] = await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.tokenHash, tokenHash)).limit(1);
      if (revokedRecord?.revokedAt) throw new AuthenticationError("Token has been revoked");

      if (sessionId) {
        const [session] = await db.select().from(schema.sessions).where(and(
          eq(schema.sessions.id, sessionId),
          eq(schema.sessions.tokenHash, tokenHash)
        )).limit(1);
        if (!session || session.expiresAt < new Date()) throw new AuthenticationError("Session expired or revoked");
      }

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (!user) throw new AuthenticationError("User account no longer exists");
      const context = await organizationService.requireWorkspaceMembership({ userId }, tenantId);

      return {
        workspaceId: tenantId,
        tenantId,
        userId,
        personalWorkspaceId: user.tenantId,
        scopes,
        sessionId,
        email: payload.email as string | undefined,
        displayName: payload.displayName as string | undefined,
        role: context.membership.role,
      };
    } catch (err: any) {
      if (err instanceof AuthenticationError) throw err;
      throw new AuthenticationError(`Authentication failed: ${err.message}`);
    }
  }

  async createEphemeralStreamTicket(principal: AuthPrincipal): Promise<string> {
    this.requirePrincipal(principal);
    const ticketId = `st_${nanoid(32)}`;
    const ticketHash = createHash("sha256").update(ticketId).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 1000);

    await db.insert(schema.streamTickets).values({
      id: nanoid(), ticketHash, tenantId: principal.tenantId, userId: principal.userId,
      scopes: principal.scopes, expiresAt, createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "STREAM_TICKET_GENERATED",
      details: { ticketHashPrefix: ticketHash.slice(0, 8) },
    });
    return ticketId;
  }

  async consumeEphemeralStreamTicket(ticketId: string): Promise<AuthPrincipal> {
    if (!ticketId || !ticketId.startsWith("st_")) throw new AuthenticationError("Invalid stream ticket format");
    const ticketHash = createHash("sha256").update(ticketId).digest("hex");
    const now = new Date();
    const [consumed] = await db.update(schema.streamTickets).set({ consumedAt: now }).where(and(
      eq(schema.streamTickets.ticketHash, ticketHash),
      isNull(schema.streamTickets.consumedAt),
      gt(schema.streamTickets.expiresAt, now)
    )).returning();
    if (!consumed) throw new AuthenticationError("Invalid, expired, or already consumed stream ticket");
    const context = await organizationService.requireWorkspaceMembership({ userId: consumed.userId }, consumed.tenantId);
    return {
      workspaceId: consumed.tenantId,
      tenantId: consumed.tenantId,
      userId: consumed.userId,
      scopes: consumed.scopes as PermissionScope[],
      role: context.membership.role,
    };
  }

  async resolvePrincipalFromRequest(request: Request): Promise<AuthPrincipal> {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) return this.verifyToken(authHeader.slice(7));
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (ticket) return this.consumeEphemeralStreamTicket(ticket);
    throw new AuthenticationError("Authorization header (Bearer token) is required");
  }

  requirePrincipal(principal?: AuthPrincipal): AuthPrincipal {
    if (!principal?.tenantId || !principal?.userId) {
      throw new AuthenticationError("Operation requires an authenticated user and tenant session");
    }
    return principal;
  }

  requireScope(principal: AuthPrincipal, requiredScope: PermissionScope): void {
    if (principal.scopes.includes("admin.all") || principal.scopes.includes(requiredScope)) return;
    auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "AUTHORIZATION_DENIED",
      status: "failure",
      details: { requiredScope, currentScopes: principal.scopes },
    });
    throw new AuthorizationError(
      `Operation requires scope '${requiredScope}', but current session only has: [${principal.scopes.join(", ")}]`,
      [requiredScope]
    );
  }

  assertTenantOwnership(principal: AuthPrincipal, resourceTenantId: string, resourceName = "resource"): void {
    if (principal.tenantId === resourceTenantId) return;
    auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "TENANT_ACCESS_DENIED",
      status: "failure",
      details: { targetTenantId: resourceTenantId, resourceName },
    });
    throw new TenantIsolationError(`Access denied: ${resourceName} does not belong to your organization/tenant.`);
  }

  async createTenantAndOwner(params: TenantOwnerBase & { issueInitialToken: false }): Promise<{ tenantId: string; userId: string }>;
  async createTenantAndOwner(params: TenantOwnerBase & { issueInitialToken?: true }): Promise<{ tenantId: string; userId: string; token: string; sessionId: string }>;
  async createTenantAndOwner(
    params: TenantOwnerBase & { issueInitialToken?: boolean }
  ): Promise<{ tenantId: string; userId: string; token?: string; sessionId?: string }> {
    const tenantId = nanoid();
    const userId = nanoid();
    const now = new Date();

    await db.insert(schema.tenants).values({ id: tenantId, name: params.tenantName, slug: params.slug, createdAt: now, updatedAt: now });
    await db.insert(schema.users).values({ id: userId, tenantId, email: params.ownerEmail.toLowerCase(), displayName: params.ownerDisplayName, role: "owner", createdAt: now, updatedAt: now });
    await db.insert(schema.memberships).values({ id: nanoid(), tenantId, userId, role: "owner", createdAt: now });

    await db.insert(schema.signatureProfiles).values([
      {
        id: nanoid(), tenantId, userId, name: "professional", displayName: "Professional Signature",
        plainText: `${params.ownerDisplayName}\n${params.tenantName}`,
        html: `<p><strong>${params.ownerDisplayName}</strong><br/>${params.tenantName}</p>`,
        signOff: "Best regards,", replyMode: "compact", newMessageMode: "full", isDefault: true,
        createdAt: now, updatedAt: now,
      },
      {
        id: nanoid(), tenantId, userId, name: "consulting", displayName: "Consulting Signature",
        plainText: `${params.ownerDisplayName} | Consultant\n${params.tenantName}`,
        html: `<p><strong>${params.ownerDisplayName}</strong> | <em>Consultant</em><br/>${params.tenantName}</p>`,
        signOff: "Sincerely,", replyMode: "full", newMessageMode: "full", isDefault: false,
        createdAt: now, updatedAt: now,
      },
    ]);

    if (params.issueInitialToken === false) return { tenantId, userId };

    const { token, sessionId } = await this.createToken({
      id: userId, tenantId, email: params.ownerEmail, displayName: params.ownerDisplayName, role: "owner",
    });
    return { tenantId, userId, token, sessionId };
  }
}

export const authService = new AuthService();
