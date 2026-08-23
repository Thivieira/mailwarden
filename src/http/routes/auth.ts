import { Hono } from "hono";
import { authService } from "../../services/auth";
import { userAuthService } from "../../services/user-auth";
import { inviteService } from "../../services/invites";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readBody } from "../context";

async function getOrCreateDevOwner(email: string, displayName?: string) {
  const normalizedEmail = email.toLowerCase();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).limit(1);

  if (!user) {
    const created = await authService.createTenantAndOwner({
      tenantName: "Personal Mailwarden",
      slug: `personal-${nanoid(6)}`,
      ownerEmail: normalizedEmail,
      ownerDisplayName: displayName || normalizedEmail.split("@")[0] || "Owner",
    });
    [user] = await db.select().from(schema.users).where(eq(schema.users.id, created.userId)).limit(1);
  }

  return user!;
}

function readAdminSecret(auth: string | undefined): string {
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export const authRoutes = new Hono()
  .basePath("/auth")

  .get("/status", (c) =>
    c.json({
      status: "ready",
      privateBeta: true,
      ownerBootstrapConfigured: Boolean(config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET),
      betaAdminConfigured: Boolean(config.BETA_ADMIN_SECRET),
      devAuthEnabled: config.ALLOW_DEV_AUTH,
    })
  )

  .post("/stream-ticket", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header (Bearer token) required" }, 401);
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const ticket = await authService.createEphemeralStreamTicket(principal);
      return c.json({ ticket, expiresInSeconds: 60, sseUrl: `${config.MCP_BASE_URL}/sse?ticket=${ticket}` });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Self-serve registration: creates an isolated vault, saves hashed credentials, seeds safe policies
  .post("/register", async (c) => {
    const body = await readBody(c);
    try {
      const password = body.password || body.loginSecret;
      const result = await userAuthService.registerUser({
        email: body.email,
        password,
        displayName: body.displayName,
        inviteCode: body.inviteCode || body.invite,
        organizationInviteToken: body.organizationInviteToken || body.organizationInvite,
      });

      return c.json({
        success: true,
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt,
        mcpUrl: result.mcpUrl,
        mcpSseUrl: `${config.MCP_BASE_URL}/sse`,
      }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  })

  .post("/signup", async (c) => {
    const body = await readBody(c);
    try {
      const password = body.password || body.loginSecret;
      const result = await userAuthService.registerUser({
        email: body.email,
        password,
        displayName: body.displayName,
        inviteCode: body.inviteCode || body.invite,
        organizationInviteToken: body.organizationInviteToken || body.organizationInvite,
      });

      return c.json({
        success: true,
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt,
        mcpUrl: result.mcpUrl,
        mcpSseUrl: `${config.MCP_BASE_URL}/sse`,
      }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  })

  // Create one-time expiring beta invite (requires logged-in user or admin)
  .post("/invites", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header (Bearer token) required" }, 401);
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const body = await readBody(c);
      const invite = await inviteService.createInvite({
        createdByUserId: principal.userId,
        email: body.email,
        expiresInDays: body.expiresInDays ? Number(body.expiresInDays) : 7,
      });

      return c.json({ success: true, invite }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // List invites created by the user
  .get("/invites", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header (Bearer token) required" }, 401);
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const invites = await inviteService.listInvites(principal.userId);
      return c.json({ invites });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Self-serve login (accepts password or loginSecret)
  .post("/login", async (c) => {
    const body = await readBody(c);
    try {
      const password = body.password || body.loginSecret;
      const user = await userAuthService.authenticateUser(body.email, password, body.displayName);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      }, undefined, "30d");

      return c.json({
        success: true,
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
        token: tokenData.token,
        expiresAt: tokenData.expiresAt.toISOString(),
        mcpUrl: `${config.APP_BASE_URL}/mcp`,
        mcpSseUrl: `${config.MCP_BASE_URL}/sse`,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Get current user profile and accounts
  .get("/me", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header (Bearer token) required" }, 401);
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const accounts = await db
        .select({
          id: schema.emailAccounts.id,
          provider: schema.emailAccounts.provider,
          emailAddress: schema.emailAccounts.emailAddress,
          displayName: schema.emailAccounts.displayName,
          status: schema.emailAccounts.status,
          priorityRole: schema.emailAccounts.priorityRole,
          lastSyncedAt: schema.emailAccounts.lastSyncedAt,
        })
        .from(schema.emailAccounts)
        .where(
          and(
            eq(schema.emailAccounts.tenantId, principal.tenantId),
            eq(schema.emailAccounts.userId, principal.userId)
          )
        );

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, principal.userId))
        .limit(1);

      return c.json({
        user: user
          ? {
              id: user.id,
              tenantId: user.tenantId,
              email: user.email,
              displayName: user.displayName,
              role: user.role,
            }
          : null,
        accounts,
        mcp: {
          sseUrl: `${config.MCP_BASE_URL}/sse`,
          rpcUrl: `${config.MCP_BASE_URL}/rpc`,
        },
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Generic private-beta login. Every user has an isolated vault and a per-user hashed secret.
  .post("/token", async (c) => {
    const body = await readBody(c);
    try {
      const secret = body.loginSecret || body.password;
      const user = await userAuthService.authenticateUser(body.email, secret, body.displayName);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      }, undefined, "30d");

      return c.json({
        token: tokenData.token,
        expiresAt: tokenData.expiresAt.toISOString(),
        tenantId: user.tenantId,
        userId: user.id,
        mcpUrl: `${config.APP_BASE_URL}/mcp`,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Backward-compatible bootstrap endpoint for the original deployment owner.
  .post("/owner/token", async (c) => {
    const body = await readBody(c);
    try {
      const user = await userAuthService.authenticateUser(body.email, body.loginSecret, body.displayName);
      if (config.OWNER_EMAIL && user.email.toLowerCase() !== config.OWNER_EMAIL.toLowerCase()) {
        return c.json({ error: "This endpoint is reserved for the deployment owner" }, 403);
      }
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: "owner",
      }, undefined, "1h");
      return c.json({
        token: tokenData.token,
        expiresAt: tokenData.expiresAt.toISOString(),
        tenantId: user.tenantId,
        userId: user.id,
        mcpUrl: `${config.APP_BASE_URL}/mcp`,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 401);
    }
  })

  // Closed-beta administration: create a completely separate private vault/user.
  .post("/beta/provision", async (c) => {
    const body = await readBody(c);
    try {
      userAuthService.verifyBetaAdminSecret(readAdminSecret(c.req.header("authorization")));
      const created = await userAuthService.provisionPrivateBetaUser(body as any);
      return c.json({
        ...created,
        warning: "The loginSecret is shown only in this response. Share it privately with the user and do not store it in source control.",
      });
    } catch (err: any) {
      return c.json({ error: err.message }, err?.name === "AuthenticationError" ? 401 : 400);
    }
  })

  // Closed-beta recovery. Invalidates the previous per-user secret immediately.
  .post("/beta/rotate-secret", async (c) => {
    const body = await readBody(c);
    try {
      userAuthService.verifyBetaAdminSecret(readAdminSecret(c.req.header("authorization")));
      const rotated = await userAuthService.rotatePrivateBetaSecret(body.email);
      return c.json({
        ...rotated,
        warning: "The new loginSecret is shown only in this response. The previous secret no longer works.",
      });
    } catch (err: any) {
      return c.json({ error: err.message }, err?.name === "AuthenticationError" ? 401 : 400);
    }
  })

  // Local-only convenience. Disabled by default and must be explicitly enabled.
  .post("/dev/token", async (c) => {
    if (!config.ALLOW_DEV_AUTH) return c.json({ error: "Not found" }, 404);

    const body = await readBody(c);
    const user = await getOrCreateDevOwner(body.email, body.displayName);
    const tokenData = await authService.createToken({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: "owner",
    });

    return c.json({
      token: tokenData.token,
      sessionId: tokenData.sessionId,
      expiresAt: tokenData.expiresAt.toISOString(),
      tenantId: user.tenantId,
      userId: user.id,
      mcpRpcUrl: `${config.APP_BASE_URL}/mcp/rpc`,
      mcpSseUrl: `${config.APP_BASE_URL}/mcp/sse`,
    });
  });
