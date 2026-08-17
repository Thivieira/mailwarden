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
import { config } from "../config";
import { renderPage } from "../ui/render";
import { NoticePage } from "../ui/pages.gen.js";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function createHonoApp() {
  const app = new Hono();

  app.use("*", cors());

  /**
   * A browser gets the designed page; anything else keeps the JSON contract. Decided by the
   * Accept header, because these paths are shared: `/api/approvals/:id/review` is opened by
   * a person, while every other `/api/*` route is called by a program.
   */
  const wantsHtml = (c: any) => (c.req.header("accept") || "").includes("text/html");

  const notice = (c: any, status: number, headline: string, detail: string, hint?: string) =>
    renderPage(
      headline,
      () => NoticePage({ host: hostOf(config.APP_BASE_URL), headline, detail, hint }),
      status
    );

  app.notFound((c) =>
    wantsHtml(c)
      ? notice(
          c,
          404,
          "Page not found",
          "There is nothing at this address.",
          "Check the link you followed, or go back to your conversation and ask for a new one."
        )
      : c.json({ error: "NotFound", message: "Route not found" }, 404)
  );

  app.onError((error, c) => {
    if (error instanceof MailwardenError) {
      return wantsHtml(c)
        ? notice(c, error.statusCode, "That did not work", error.message)
        : c.json(error.toJSON(), error.statusCode as any);
    }

    const errMsg = (error as any)?.message || String(error);
    logger.error("Unhandled HTTP error", { error: errMsg });

    // The exception text stays in the logs. A browser gets something actionable instead.
    return wantsHtml(c)
      ? notice(
          c,
          500,
          "Something went wrong",
          "Mailwarden could not finish that request.",
          "Nothing was changed. Go back to your conversation and try again; if it keeps happening the problem is on our side."
        )
      : c.json({ error: "InternalServerError", message: "An internal server error occurred" }, 500);
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
