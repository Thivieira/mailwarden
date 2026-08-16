import { Elysia, t } from "elysia";
import { authService } from "../../services/auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

async function getOrCreateOwner(email: string, displayName?: string) {
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

export const authRoutes = new Elysia({ prefix: "/auth", aot: false })
  .get("/status", () => ({
    status: "ready",
    ownerAuthConfigured: Boolean(config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET),
    devAuthEnabled: config.ALLOW_DEV_AUTH,
  }))

  .post("/stream-ticket", async ({ headers, set }) => {
    const authHeader = headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      return { error: "Authorization header (Bearer token) required" };
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const ticket = await authService.createEphemeralStreamTicket(principal);
      return { ticket, expiresInSeconds: 60, sseUrl: `${config.MCP_BASE_URL}/sse?ticket=${ticket}` };
    } catch (err: any) {
      set.status = 401;
      return { error: err.message };
    }
  })

  // Personal production bootstrap. This is intentionally single-owner and secret protected.
  .post(
    "/owner/token",
    async ({ body, set }) => {
      if (!config.OWNER_EMAIL || !config.OWNER_LOGIN_SECRET) {
        set.status = 503;
        return { error: "Owner authentication is not configured" };
      }
      if (body.email.toLowerCase() !== config.OWNER_EMAIL.toLowerCase() || body.loginSecret !== config.OWNER_LOGIN_SECRET) {
        set.status = 401;
        return { error: "Invalid owner credentials" };
      }

      const user = await getOrCreateOwner(body.email, body.displayName);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: "owner",
      }, undefined, "1h");

      return {
        token: tokenData.token,
        expiresAt: tokenData.expiresAt.toISOString(),
        tenantId: user.tenantId,
        userId: user.id,
        mcpUrl: `${config.APP_BASE_URL}/mcp`,
        mcpRpcUrl: `${config.APP_BASE_URL}/mcp/rpc`,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        loginSecret: t.String(),
        displayName: t.Optional(t.String()),
      }),
    }
  )

  // Local-only convenience. Disabled by default and must be explicitly enabled.
  .post(
    "/dev/token",
    async ({ body, set }) => {
      if (!config.ALLOW_DEV_AUTH) {
        set.status = 404;
        return { error: "Not found" };
      }

      const user = await getOrCreateOwner(body.email, body.displayName);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: "owner",
      });

      return {
        token: tokenData.token,
        sessionId: tokenData.sessionId,
        expiresAt: tokenData.expiresAt.toISOString(),
        tenantId: user.tenantId,
        userId: user.id,
        mcpRpcUrl: `${config.APP_BASE_URL}/mcp/rpc`,
        mcpSseUrl: `${config.APP_BASE_URL}/mcp/sse`,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        displayName: t.Optional(t.String()),
        tenantName: t.Optional(t.String()),
      }),
    }
  );
