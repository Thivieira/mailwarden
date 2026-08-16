import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { oauthRoutes } from "./routes/oauth";
import { mcpRoutes } from "./routes/mcp-sse";
import { managementRoutes } from "./routes/management";
import { logger } from "../utils/logger";
import { MailwardenError } from "../utils/errors";

export function createElysiaApp() {
  const isCloudflareWorker = typeof (globalThis as any).WebSocketPair !== "undefined" || (typeof process !== "undefined" && !process.versions?.bun);

  const app = new Elysia({ aot: false })
    .use(cors())
    .onError(({ code, error, set }) => {
      if (error instanceof MailwardenError) {
        set.status = error.statusCode;
        return error.toJSON();
      }

      const errMsg = (error as any)?.message || String(error);
      logger.error("Unhandled HTTP error", { code, error: errMsg });
      set.status = 500;
      return {
        error: "InternalServerError",
        message: "An internal server error occurred",
      };
    })
    // Mount routes
    .use(healthRoutes)
    .use(authRoutes)
    .use(oauthRoutes)
    .use(mcpRoutes)
    .use(managementRoutes)
    .get("/", () => ({
      name: "Mailwarden",
      tagline: "AI-native email operating layer",
      status: "online",
      documentation: "/swagger",
      mcpEndpoint: "/mcp/rpc",
      sseEndpoint: "/mcp/sse",
      healthCheck: "/health",
    }))
    .get("/swagger", () => ({
      openapi: "3.0.0",
      info: {
        title: "Mailwarden API",
        version: "1.0.0",
        description: "AI-native email operating layer & secure MCP boundary",
      },
      paths: {
        "/health": { get: { summary: "Health check" } },
        "/mcp/rpc": { post: { summary: "MCP JSON-RPC endpoint" } },
        "/mcp/sse": { get: { summary: "MCP SSE Stream" } },
        "/.well-known/oauth-protected-resource": { get: { summary: "OAuth 2.0 Protected Resource Metadata (RFC 9728)" } },
        "/.well-known/oauth-authorization-server": { get: { summary: "OAuth 2.0 Authorization Server Metadata (RFC 8414)" } },
        "/oauth/authorize": { get: { summary: "OAuth Authorize" }, post: { summary: "OAuth Authorize Submit" } },
        "/oauth/token": { post: { summary: "OAuth Token Exchange & Refresh" } },
        "/oauth/revoke": { post: { summary: "OAuth Token Revocation (RFC 7009)" } },
      },
    }));

  // In Bun development environment, dynamically add full interactive Swagger UI
  if (typeof (globalThis as any).Bun !== "undefined" && !isCloudflareWorker) {
    try {
      const { swagger } = require("@elysiajs/swagger");
      app.use(
        swagger({
          documentation: {
            info: {
              title: "Mailwarden API",
              version: "1.0.0",
              description: "AI-native email operating layer & secure MCP boundary",
            },
          },
        })
      );
    } catch {
      // Ignore if unavailable
    }
  }

  return app;
}

export const app = createElysiaApp();
