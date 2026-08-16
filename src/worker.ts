import { app } from "./http/app";
import { getDatabase } from "./db";
import { updateConfig } from "./config";
import { logger } from "./utils/logger";
import type { D1DatabaseBinding } from "./db";

export type WorkerEnv = {
  DB: D1DatabaseBinding;
  APP_BASE_URL?: string;
  MCP_BASE_URL?: string;
  AUTH_SECRET?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  KEY_VERSION?: string;
  MAILBOX_MUTATIONS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
};

export default {
  /**
   * Main HTTP / MCP Fetch Handler for Cloudflare Workers
   */
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const origin = new URL(request.url).origin;

    // 1. Initialize environment config from Cloudflare Worker vars/secrets & active origin
    if (env) {
      updateConfig({
        APP_BASE_URL: env.APP_BASE_URL || origin,
        MCP_BASE_URL: env.MCP_BASE_URL || `${origin}/mcp`,
        ...env,
      });
    }

    // 2. Bind D1 instance
    if (env.DB) {
      getDatabase(env.DB);
    }

    // 3. Forward request to Elysia application
    return app.fetch(request);
  },

  /**
   * Scheduled Cron Handler for background sync and intelligence updates
   */
  async scheduled(
    event: { cron: string; scheduledTime: number },
    env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    if (env) {
      updateConfig(env);
    }
    if (env.DB) {
      getDatabase(env.DB);
    }

    ctx.waitUntil(
      (async () => {
        logger.info(`[WORKER CRON] Scheduled background sync triggered: ${event.cron}`);
        if (!env.DB) {
          logger.warn("[WORKER CRON] No D1 database binding found, skipping background sync");
          return;
        }

        const db = getDatabase(env.DB);
        const { schema } = await import("./db");
        const { eq } = await import("drizzle-orm");

        // Fetch active accounts for background health & sync check
        const activeAccounts = await db
          .select()
          .from(schema.emailAccounts)
          .where(eq(schema.emailAccounts.status, "connected"));

        logger.info(`[WORKER CRON] Active accounts to sync: ${activeAccounts.length}`);
      })()
    );
  },
};
