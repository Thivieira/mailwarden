import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "@mailwarden/db/schema";
import { config } from "../config";

export type D1DatabaseBinding = any;

let activeDb: any = null;

export function setDatabase(databaseInstance: any) {
  activeDb = databaseInstance;
}

export function getDatabase(customBindingOrPath?: string | D1DatabaseBinding): any {
  // 1. If a Cloudflare D1 binding is provided or found in global scope
  const d1Binding =
    customBindingOrPath && typeof customBindingOrPath === "object" && "prepare" in customBindingOrPath
      ? customBindingOrPath
      : (globalThis as any).DB;

  if (d1Binding && typeof d1Binding === "object" && "prepare" in d1Binding) {
    activeDb = drizzleD1(d1Binding, { schema });
    return activeDb;
  }

  if (activeDb && !customBindingOrPath) return activeDb;

  // 2. Local Bun SQLite (for dev, tests, CLI)
  try {
    const { Database } = require("bun:sqlite");
    const { drizzle: drizzleBun } = require("drizzle-orm/bun-sqlite");
    const { existsSync, mkdirSync } = require("fs");
    const { dirname } = require("path");

    const dbPath = typeof customBindingOrPath === "string" ? customBindingOrPath : config.DATABASE_URL;
    if (dbPath.startsWith("./") || dbPath.startsWith("../") || dbPath.startsWith("/")) {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    const sqliteDb = new Database(dbPath, { create: true });
    sqliteDb.run("PRAGMA journal_mode = WAL;");
    sqliteDb.run("PRAGMA foreign_keys = ON;");

    activeDb = drizzleBun(sqliteDb, { schema });
    return activeDb;
  } catch {
    if (activeDb) return activeDb;
    throw new Error("No database binding or SQLite engine available");
  }
}

export type DbClient = ReturnType<typeof getDatabase>;

// Proxy `db` so all services importing `db` seamlessly query either local SQLite or Cloudflare D1
export const db: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const current = activeDb || getDatabase();
      const value = current[prop];
      if (typeof value === "function") {
        return value.bind(current);
      }
      return value;
    },
  }
);

export { schema };
