import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { oauthRoutes } from "./routes/oauth";
import { mcpRoutes } from "./routes/mcp-sse";
import { managementRoutes } from "./routes/management";
import { providerConnectRoutes } from "./routes/provider-connect";
import { fontRoutes } from "./routes/fonts";
import { logger } from "../utils/logger";
import { MailwardenError } from "../utils/errors";

export function createHonoApp() {
  const app = new Hono();

  app.use("*", cors());

  app.onError((error, c) => {
    if (error instanceof MailwardenError) {
      return c.json(error.toJSON(), error.statusCode as any);
    }

    const errMsg = (error as any)?.message || String(error);
    logger.error("Unhandled HTTP error", { error: errMsg });
    return c.json({ error: "InternalServerError", message: "An internal server error occurred" }, 500);
  });

  app.route("/", fontRoutes);
  app.route("/", healthRoutes);
  app.route("/", authRoutes);
  app.route("/", oauthRoutes);
  app.route("/", mcpRoutes);
  app.route("/", providerConnectRoutes);
  app.route("/", managementRoutes);

  app.get("/", (c) =>
    c.json({
      name: "Mailwarden",
      tagline: "Your email, managed through normal conversation.",
      status: "online",
      documentation: "/swagger",
      mcpEndpoint: "/mcp",
      rpcEndpoint: "/mcp/rpc",
      sseEndpoint: "/mcp/sse",
      healthCheck: "/health",
    })
  );

  app.get("/swagger", (c) =>
    c.json({
      openapi: "3.0.0",
      info: {
        title: "Mailwarden API",
        version: "1.0.0",
        description: "Secure conversational email layer",
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
    })
  );

  return app;
}

export const app = createHonoApp();
