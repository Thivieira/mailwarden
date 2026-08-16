import { Elysia, t } from "elysia";
import { authService } from "../../services/auth";
import { userAuthService } from "../../services/user-auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

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

function readAdminSecret(headers: Record<string, string | undefined>): string {
  const auth = headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export const authRoutes = new Elysia({ prefix: "/auth", aot: false })
  .get("/status", () => ({
    status: "ready",
    privateBeta: true,
    ownerBootstrapConfigured: Boolean(config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET),
    betaAdminConfigured: Boolean(config.BETA_ADMIN_SECRET),
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

  // Generic private-beta login. Every user has an isolated vault and a per-user hashed secret.
  .post(
    "/token",
    async ({ body, set }) => {
      try {
        const user = await userAuthService.authenticateUser(body.email, body.loginSecret, body.displayName);
        const tokenData = await authService.createToken({
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        }, undefined, "1h");

        return {
          token: tokenData.token,
          expiresAt: tokenData.expiresAt.toISOString(),
          tenantId: user.tenantId,
          userId: user.id,
          mcpUrl: `${config.APP_BASE_URL}/mcp`,
        };
      } catch (err: any) {
        set.status = 401;
        return { error: err.message };
      }
    },
    {
      body: t.Object({
        email: t.String(),
        loginSecret: t.String(),
        displayName: t.Optional(t.String()),
      }),
    }
  )

  // Backward-compatible bootstrap endpoint for the original deployment owner.
  .post(
    "/owner/token",
    async ({ body, set }) => {
      try {
        const user = await userAuthService.authenticateUser(body.email, body.loginSecret, body.displayName);
        if (config.OWNER_EMAIL && user.email.toLowerCase() !== config.OWNER_EMAIL.toLowerCase()) {
          set.status = 403;
          return { error: "This endpoint is reserved for the deployment owner" };
        }
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
        };
      } catch (err: any) {
        set.status = 401;
        return { error: err.message };
      }
    },
    {
      body: t.Object({
        email: t.String(),
        loginSecret: t.String(),
        displayName: t.Optional(t.String()),
      }),
    }
  )

  // Closed-beta administration: create a completely separate private vault/user.
  .post(
    "/beta/provision",
    async ({ headers, body, set }) => {
      try {
        userAuthService.verifyBetaAdminSecret(readAdminSecret(headers as any));
        const created = await userAuthService.provisionPrivateBetaUser(body);
        return {
          ...created,
          warning: "The loginSecret is shown only in this response. Share it privately with the user and do not store it in source control.",
        };
      } catch (err: any) {
        set.status = err?.name === "AuthenticationError" ? 401 : 400;
        return { error: err.message };
      }
    },
    {
      body: t.Object({
        email: t.String(),
        displayName: t.String(),
        vaultName: t.Optional(t.String()),
      }),
    }
  )

  // Closed-beta recovery. Invalidates the previous per-user secret immediately.
  .post(
    "/beta/rotate-secret",
    async ({ headers, body, set }) => {
      try {
        userAuthService.verifyBetaAdminSecret(readAdminSecret(headers as any));
        const rotated = await userAuthService.rotatePrivateBetaSecret(body.email);
        return {
          ...rotated,
          warning: "The new loginSecret is shown only in this response. The previous secret no longer works.",
        };
      } catch (err: any) {
        set.status = err?.name === "AuthenticationError" ? 401 : 400;
        return { error: err.message };
      }
    },
    { body: t.Object({ email: t.String() }) }
  )

  // Local-only convenience. Disabled by default and must be explicitly enabled.
  .post(
    "/dev/token",
    async ({ body, set }) => {
      if (!config.ALLOW_DEV_AUTH) {
        set.status = 404;
        return { error: "Not found" };
      }

      const user = await getOrCreateDevOwner(body.email, body.displayName);
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
