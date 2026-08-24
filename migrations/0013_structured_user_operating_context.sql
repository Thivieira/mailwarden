-- Structured UOC additions; existing organizations/projects/relationships/accounts remain authoritative.
CREATE TABLE IF NOT EXISTS user_services (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT,
  environment TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'active',
  domains TEXT NOT NULL DEFAULT '[]',
  account_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_services_name_idx ON user_services(tenant_id, user_id, name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_services_status_idx ON user_services(tenant_id, user_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_commitments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  counterparty TEXT,
  amount_minor INTEGER,
  currency TEXT,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  related_service_id TEXT REFERENCES user_services(id) ON DELETE SET NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_commitments_status_idx ON user_commitments(tenant_id, user_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_commitments_due_idx ON user_commitments(tenant_id, user_id, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_commitments_service_idx ON user_commitments(related_service_id);
