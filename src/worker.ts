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
  OWNER_EMAIL?: string;
  OWNER_LOGIN_SECRET?: string;
  ALLOW_DEV_AUTH?: string;
  MAILBOX_MUTATIONS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REDIRECT_URI?: string;
  MICROSOFT_TENANT_ID?: string;
};

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    _ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const origin = new URL(request.url).origin;

    if (env) {
      updateConfig({
        APP_BASE_URL: env.APP_BASE_URL || origin,
        MCP_BASE_URL: env.MCP_BASE_URL || `${origin}/mcp`,
        ...env,
      });
    }

    if (env.DB) getDatabase(env.DB);
    return app.fetch(request);
  },

  async scheduled(
    event: { cron: string; scheduledTime: number },
    env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    updateConfig(env || {});
    if (env.DB) getDatabase(env.DB);

    ctx.waitUntil(
      (async () => {
        logger.info(`[WORKER CRON] Mailbox sync triggered: ${event.cron}`);
        if (!env.DB) {
          logger.warn("[WORKER CRON] No D1 binding, skipping sync");
          return;
        }

        const { syncService } = await import("./services/sync");
        const results = await syncService.syncAllConnectedAccounts(25);
        const successful = results.filter((r: any) => r.ok).length;
        const failed = results.length - successful;
        logger.info("[WORKER CRON] Mailbox sync completed", {
          accounts: results.length,
          successful,
          failed,
        });
      })()
    );
  },
};
