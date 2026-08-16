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

const JWT_SECRET = new TextEncoder().encode(config.AUTH_SECRET);

export class AuthService {
  /**
   * Generates a signed JWT session token for an authenticated user
   */
  async createToken(
    user: { id: string; tenantId: string; email: string; displayName: string; role?: "owner" | "admin" | "member" },
    scopes: PermissionScope[] = ALL_SCOPES,
    expiresIn = "30d"
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const sessionId = nanoid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default

    const token = await new SignJWT({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role || "member",
      scopes,
      sessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(JWT_SECRET);

    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Store active session in database
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
      details: { scopesCount: scopes.length },
    });

    return { token, sessionId, expiresAt };
  }

  /**
   * Verifies a JWT bearer token and returns the authenticated principal
   */
  async verifyToken(tokenInput: string): Promise<AuthPrincipal> {
    if (!tokenInput) {
      throw new AuthenticationError("Authentication token is required");
    }

    let cleanToken = tokenInput.trim();
    if (cleanToken.startsWith("Bearer ")) {
      cleanToken = cleanToken.slice(7).trim();
    }

    try {
      const { payload } = await jwtVerify(cleanToken, JWT_SECRET);

      const userId = payload.sub as string;
      const tenantId = payload.tenantId as string;
      const scopes = (payload.scopes as PermissionScope[]) || [];
      const sessionId = payload.sessionId as string | undefined;

      if (!userId || !tenantId) {
        throw new AuthenticationError("Invalid token payload: missing user or tenant identity");
      }

      const tokenHash = createHash("sha256").update(cleanToken).digest("hex");

      // Check if token has been explicitly revoked
      const [revokedRecord] = await db
        .select()
        .from(schema.oauthTokens)
        .where(eq(schema.oauthTokens.tokenHash, tokenHash))
        .limit(1);

      if (revokedRecord && revokedRecord.revokedAt) {
        throw new AuthenticationError("Token has been revoked");
      }

      // Check session in database if sessionId is present
      if (sessionId) {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.tokenHash, tokenHash)))
          .limit(1);

        if (!session || session.expiresAt < new Date()) {
          throw new AuthenticationError("Session expired or revoked");
        }
      }

      // Verify user is still active in database
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (!user) {
        throw new AuthenticationError("User account no longer exists");
      }

      return {
        tenantId,
        userId,
        scopes,
        sessionId,
        email: payload.email as string | undefined,
        displayName: payload.displayName as string | undefined,
        role: payload.role as "owner" | "admin" | "member" | undefined,
      };
    } catch (err: any) {
      if (err instanceof AuthenticationError) throw err;
      throw new AuthenticationError(`Authentication failed: ${err.message}`);
    }
  }

  /**
   * Generates a short-lived (60s) single-use stream ticket for header-less SSE connections.
   * Stored in shared database with SHA-256 hash to prevent token leakage and guarantee distributed atomicity.
   */
  async createEphemeralStreamTicket(principal: AuthPrincipal): Promise<string> {
    this.requirePrincipal(principal);
    const ticketId = `st_${nanoid(32)}`;
    const ticketHash = createHash("sha256").update(ticketId).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds TTL

    await db.insert(schema.streamTickets).values({
      id: nanoid(),
      ticketHash,
      tenantId: principal.tenantId,
      userId: principal.userId,
      scopes: principal.scopes,
      expiresAt,
      createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "STREAM_TICKET_GENERATED",
      details: { ticketHashPrefix: ticketHash.slice(0, 8) },
    });

    return ticketId;
  }

  /**
   * Consumes a single-use ephemeral stream ticket atomically using database-level locking/update.
   * Guarantees that two concurrent requests across different Worker instances cannot double-redeem.
   */
  async consumeEphemeralStreamTicket(ticketId: string): Promise<AuthPrincipal> {
    if (!ticketId || typeof ticketId !== "string" || !ticketId.startsWith("st_")) {
      throw new AuthenticationError("Invalid stream ticket format");
    }

    const ticketHash = createHash("sha256").update(ticketId).digest("hex");
    const now = new Date();

    // Atomic consumption: update consumedAt only if currently null and not expired
    const [consumed] = await db
      .update(schema.streamTickets)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.streamTickets.ticketHash, ticketHash),
          isNull(schema.streamTickets.consumedAt),
          gt(schema.streamTickets.expiresAt, now)
        )
      )
      .returning();

    if (!consumed) {
      throw new AuthenticationError("Invalid, expired, or already consumed stream ticket");
    }

    return {
      tenantId: consumed.tenantId,
      userId: consumed.userId,
      scopes: consumed.scopes as PermissionScope[],
    };
  }

  /**
   * Helper to extract and verify token from Authorization header or single-use stream ticket.
   * Never accepts long-lived bearer tokens in URL query or path.
   */
  async resolvePrincipalFromRequest(request: Request): Promise<AuthPrincipal> {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return this.verifyToken(authHeader.slice(7));
    }

    const url = new URL(request.url);
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      return this.consumeEphemeralStreamTicket(ticket);
    }

    throw new AuthenticationError("Authorization header (Bearer token) is required");
  }

  /**
   * Enforces that an authenticated principal exists
   */
  requirePrincipal(principal?: AuthPrincipal): AuthPrincipal {
    if (!principal || !principal.tenantId || !principal.userId) {
      throw new AuthenticationError("Operation requires an authenticated user and tenant session");
    }
    return principal;
  }

  /**
   * Enforces that the principal holds the required permission scope
   */
  requireScope(principal: AuthPrincipal, requiredScope: PermissionScope): void {
    if (principal.scopes.includes("admin.all")) return;
    if (!principal.scopes.includes(requiredScope)) {
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
  }

  /**
   * Enforces tenant isolation: throws if a resource's tenantId does not match the principal's tenantId
   */
  assertTenantOwnership(principal: AuthPrincipal, resourceTenantId: string, resourceName = "resource"): void {
    if (principal.tenantId !== resourceTenantId) {
      auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "TENANT_ACCESS_DENIED",
        status: "failure",
        details: { targetTenantId: resourceTenantId, resourceName },
      });
      throw new TenantIsolationError(
        `Access denied: ${resourceName} does not belong to your organization/tenant.`
      );
    }
  }

  /**
   * Creates a tenant, initial user, and default signature profile
   */
  async createTenantAndOwner(params: {
    tenantName: string;
    slug: string;
    ownerEmail: string;
    ownerDisplayName: string;
  }) {
    const tenantId = nanoid();
    const userId = nanoid();
    const now = new Date();

    await db.insert(schema.tenants).values({
      id: tenantId,
      name: params.tenantName,
      slug: params.slug,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.users).values({
      id: userId,
      tenantId,
      email: params.ownerEmail.toLowerCase(),
      displayName: params.ownerDisplayName,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.memberships).values({
      id: nanoid(),
      tenantId,
      userId,
      role: "owner",
      createdAt: now,
    });

    // Create default signature profiles
    await db.insert(schema.signatureProfiles).values([
      {
        id: nanoid(),
        tenantId,
        userId,
        name: "professional",
        displayName: "Professional Signature",
        plainText: `${params.ownerDisplayName}\n${params.tenantName}`,
        html: `<p><strong>${params.ownerDisplayName}</strong><br/>${params.tenantName}</p>`,
        signOff: "Best regards,",
        replyMode: "compact",
        newMessageMode: "full",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        tenantId,
        userId,
        name: "consulting",
        displayName: "Consulting Signature",
        plainText: `${params.ownerDisplayName} | Consultant\n${params.tenantName}`,
        html: `<p><strong>${params.ownerDisplayName}</strong> | <em>Consultant</em><br/>${params.tenantName}</p>`,
        signOff: "Sincerely,",
        replyMode: "full",
        newMessageMode: "full",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const { token, sessionId } = await this.createToken({
      id: userId,
      tenantId,
      email: params.ownerEmail,
      displayName: params.ownerDisplayName,
      role: "owner",
    });

    return {
      tenantId,
      userId,
      token,
      sessionId,
    };
  }
}

export const authService = new AuthService();
