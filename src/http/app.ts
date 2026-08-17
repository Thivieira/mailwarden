import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { oauthRoutes } from "./routes/oauth";
import { mcpRoutes } from "./routes/mcp-sse";
import { managementRoutes } from "./routes/management";
import { providerConnectRoutes } from "./routes/provider-connect";
import { fontRoutes } from "./routes/fonts";
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
      return { error: "InternalServerError", message: "An internal server error occurred" };
    })
    .use(fontRoutes)
    .use(healthRoutes)
    .use(authRoutes)
    .use(oauthRoutes)
    .use(mcpRoutes)
    .use(providerConnectRoutes)
    .use(managementRoutes)
    .get("/", () => ({
      name: "Mailwarden",
      tagline: "Your email, managed through normal conversation.",
      status: "online",
      documentation: "/swagger",
      mcpEndpoint: "/mcp",
      rpcEndpoint: "/mcp/rpc",
      sseEndpoint: "/mcp/sse",
      healthCheck: "/health",
    }))
    .get("/swagger", () => ({
      openapi: "3.0.0",
      info: {
        title: "Mailwarden API",
        version: "1.0.0",
        description: "Conversational email with human-approved sending",
      },
      paths: {
        "/health": { get: { summary: "Health check" } },
        "/mcp": { post: { summary: "Remote MCP JSON-RPC endpoint" } },
        "/mcp/rpc": { post: { summary: "MCP JSON-RPC endpoint" } },
        "/mcp/sse": { get: { summary: "Legacy MCP SSE Stream" } },
        "/.well-known/oauth-protected-resource": { get: { summary: "OAuth Protected Resource Metadata" } },
        "/.well-known/oauth-authorization-server": { get: { summary: "OAuth Authorization Server Metadata" } },
        "/oauth/authorize": { get: { summary: "OAuth Authorize" }, post: { summary: "OAuth Authorize Submit" } },
        "/oauth/token": { post: { summary: "OAuth Token Exchange & Refresh" } },
        "/oauth/revoke": { post: { summary: "OAuth Token Revocation" } },
        "/api/connect/google": { get: { summary: "Connect Gmail" } },
        "/api/connect/microsoft": { get: { summary: "Connect Outlook" } },
        "/api/connect/proton": { post: { summary: "Connect Proton Bridge gateway" } },
        "/api/accounts/sync-all": { post: { summary: "Synchronize all connected mailboxes" } },
      },
    }));

  if (typeof (globalThis as any).Bun !== "undefined" && !isCloudflareWorker) {
    try {
      const { swagger } = require("@elysiajs/swagger");
      app.use(swagger({ documentation: { info: { title: "Mailwarden API", version: "1.0.0", description: "Conversational email with human-approved sending" } } }));
    } catch {
      // Swagger UI is optional in Worker runtime.
    }
  }

  return app;
}

export const app = createElysiaApp();
