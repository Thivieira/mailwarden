CREATE TABLE IF NOT EXISTS user_auth_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 120000,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_auth_credentials_user_idx ON user_auth_credentials(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_auth_credentials_tenant_user_idx ON user_auth_credentials(tenant_id, user_id);
