import { Hono } from "hono";
import { db, schema } from "../../db";
import { config } from "../../config";
import { sql } from "drizzle-orm";
import { BUILD } from "../../build-info.gen";

async function health(c: any) {
  let dbStatus = "healthy";
  try {
    await db.select({ count: sql`count(*)` }).from(schema.tenants);
  } catch (err: any) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  return c.json({
    status: dbStatus === "healthy" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: BUILD.version,
    commit: BUILD.commit,
    builtAt: BUILD.builtAt,
    checks: {
      database: dbStatus,
      encryption: "configured",
      ownerAuthConfigured: Boolean(config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET),
      mailboxMutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED,
      googleConfigured: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      microsoftConfigured: Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET),
      protonGateway: "external-local-service",
    },
  });
}

export const healthRoutes = new Hono()
  .get("/health", health)
  .get("/api/health", health);
