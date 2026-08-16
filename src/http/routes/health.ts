import { Elysia } from "elysia";
import { db, schema } from "../../db";
import { config } from "../../config";
import { sql } from "drizzle-orm";

export const healthRoutes = new Elysia({ prefix: "/health", aot: false }).get("/", async () => {
  let dbStatus = "healthy";
  try {
    await db.select({ count: sql`count(*)` }).from(schema.tenants);
  } catch (err: any) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  return {
    status: dbStatus === "healthy" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    checks: {
      database: dbStatus,
      encryption: "configured",
      ownerAuthConfigured: Boolean(config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET),
      mailboxMutationsEnabled: config.MAILBOX_MUTATIONS_ENABLED,
      googleConfigured: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      microsoftConfigured: Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET),
      protonGateway: "external-local-service",
    },
  };
});
