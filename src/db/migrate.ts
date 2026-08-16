import { getDatabase } from "./index";
import { logger } from "../utils/logger";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export async function runMigrations(customDbPath?: string) {
  logger.info("Running database migrations...");
  const db = getDatabase(customDbPath);

  // Ensure migration tracking table exists
  try {
    db.$client.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
  } catch (err: any) {
    // ignore
  }

  // Fetch applied migrations
  const appliedRows: any[] = db.$client.query("SELECT id FROM _migrations").all() || [];
  const appliedSet = new Set(appliedRows.map((r) => r.id));

  // Read migrations directory
  const migrationsDir = join(import.meta.dir, "migrations");
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      logger.info(`Applying migration: ${file}`);
      const sqlContent = readFileSync(join(migrationsDir, file), "utf8");
      
      // Execute migration statements
      const statements = sqlContent
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          db.$client.run(statement);
        } catch (stmtErr: any) {
          // If table or index already exists, log and proceed
          if (!stmtErr.message.includes("already exists") && !stmtErr.message.includes("duplicate column")) {
            throw stmtErr;
          }
        }
      }

      db.$client.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [file, Date.now()]);
    }
    logger.info("✅ All migrations applied successfully");
  } catch (err: any) {
    logger.error("Migration error", { error: err.message });
    throw err;
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
