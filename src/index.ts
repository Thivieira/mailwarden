import { app } from "./http/app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { runMigrations } from "./db/migrate";

async function bootstrap() {
  logger.info("Initializing Mailwarden engine...");

  // Run database migrations on startup
  await runMigrations();

  const server = Bun.serve({
    port: config.PORT,
    hostname: config.HOST,
    fetch: app.fetch,
  });

  logger.info(`🛡️ Mailwarden is listening on http://${server.hostname}:${server.port}`);
  logger.info(`📖 API Documentation: http://${server.hostname}:${server.port}/swagger`);
  logger.info(`🔌 MCP JSON-RPC: http://${server.hostname}:${server.port}/mcp/rpc`);
  logger.info(`📡 MCP SSE Transport: http://${server.hostname}:${server.port}/mcp/sse`);
  logger.info(`⚙️ Mailbox mutations enabled: ${config.MAILBOX_MUTATIONS_ENABLED}`);
}

bootstrap().catch((err) => {
  logger.error("Failed to start Mailwarden server", { error: err.message });
  process.exit(1);
});
