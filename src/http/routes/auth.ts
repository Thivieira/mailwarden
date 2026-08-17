import { Hono } from "hono";
import { authService } from "../../services/auth";
import { userAuthService } from "../../services/user-auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
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

  // Generic private-beta login. Every user has an isolated vault and a per-user hashed secret.
  .post("/token", async (c) => {
    const body = await readBody(c);
    try {
      const user = await userAuthService.authenticateUser(body.email, body.loginSecret, body.displayName);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
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
