import { app } from "./http/app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { runMigrations } from "./db/migrate";

async function bootstrap() {
  logger.info("Initializing Mailwarden engine...");

  // Run database migrations on startup
  await runMigrations();

  app.listen({ port: config.PORT, hostname: config.HOST }, ({ hostname, port }) => {
    logger.info(`🛡️ Mailwarden is listening on http://${hostname}:${port}`);
    logger.info(`📖 API Documentation: http://${hostname}:${port}/swagger`);
    logger.info(`🔌 MCP JSON-RPC: http://${hostname}:${port}/mcp/rpc`);
    logger.info(`📡 MCP SSE Transport: http://${hostname}:${port}/mcp/sse`);
    logger.info(`⚙️ Mailbox mutations enabled: ${config.MAILBOX_MUTATIONS_ENABLED}`);
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to start Mailwarden server", { error: err.message });
  process.exit(1);
});
