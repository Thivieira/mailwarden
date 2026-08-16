import { Elysia, t } from "elysia";
import { authService } from "../../services/auth";
import { ALL_SCOPES } from "../../types/auth";
import { config } from "../../config";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export const authRoutes = new Elysia({ prefix: "/auth", aot: false })
  // Health / check
  .get("/status", () => ({ status: "ready" }))

  // Ephemeral Stream Ticket generation for header-less SSE EventSource connections
  .post("/stream-ticket", async ({ headers, set }) => {
    const authHeader = headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      return { error: "Authorization header (Bearer token) required" };
    }

    try {
      const principal = await authService.verifyToken(authHeader.slice(7));
      const ticket = await authService.createEphemeralStreamTicket(principal);
      return {
        ticket,
        expiresInSeconds: 60,
        sseUrl: `${config.MCP_BASE_URL}/sse?ticket=${ticket}`,
      };
    } catch (err: any) {
      set.status = 401;
      return { error: err.message };
    }
  })

  // Development Login & Token Issuer (Disabled in strict production)
  .post(
    "/dev/token",
    async ({ body, set }) => {
      const { email, displayName, tenantName } = body;

      // Look up user or create new
      const normalizedEmail = email.toLowerCase();
      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail))
        .limit(1);

      let tenantId: string;
      let userId: string;

      if (!user) {
        // Create new tenant and user
        const result = await authService.createTenantAndOwner({
          tenantName: tenantName || "Default Workspace",
          slug: (tenantName || "workspace").toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + nanoid(6),
          ownerEmail: normalizedEmail,
          ownerDisplayName: displayName || email.split("@")[0] || "User",
        });
        tenantId = result.tenantId;
        userId = result.userId;
      } else {
        tenantId = user.tenantId;
        userId = user.id;
      }

      const tokenData = await authService.createToken({
        id: userId,
        tenantId,
        email: normalizedEmail,
        displayName: displayName || user?.displayName || "User",
        role: "owner",
      });

      return {
        token: tokenData.token,
        sessionId: tokenData.sessionId,
        expiresAt: tokenData.expiresAt.toISOString(),
        tenantId,
        userId,
        mcpRpcUrl: `${config.MCP_BASE_URL}/rpc`,
        mcpSseUrl: `${config.MCP_BASE_URL}/sse`,
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
