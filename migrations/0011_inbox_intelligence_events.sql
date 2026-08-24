-- Additive L1/L2 event persistence. Message rows remain authoritative and intact.
CREATE TABLE IF NOT EXISTS message_facts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  feature_version TEXT NOT NULL,
  facts TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  rfc_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS message_facts_email_idx ON message_facts(email_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS message_facts_tenant_user_idx ON message_facts(tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS message_facts_content_hash_idx ON message_facts(tenant_id, user_id, content_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS triage_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  normalized_subject TEXT NOT NULL DEFAULT '',
  observed_state TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER NOT NULL DEFAULT 1,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_events_tenant_user_idx ON triage_events(tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_events_status_idx ON triage_events(tenant_id, user_id, observed_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_events_last_observed_idx ON triage_events(last_observed_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS triage_event_keys (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES triage_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS triage_event_keys_identity_idx ON triage_event_keys(tenant_id, user_id, value);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_keys_event_idx ON triage_event_keys(event_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS triage_event_members (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES triage_events(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  membership_reason TEXT NOT NULL,
  superseded_by_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS triage_event_members_email_idx ON triage_event_members(email_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_members_event_idx ON triage_event_members(event_id, observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_members_tenant_user_idx ON triage_event_members(tenant_id, user_id);
