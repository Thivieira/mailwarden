-- Reversible event corrections. Messages and memberships remain untouched.
ALTER TABLE triage_events ADD COLUMN merged_into_event_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_events_merged_idx ON triage_events(tenant_id, user_id, merged_into_event_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS triage_event_changes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES triage_events(id) ON DELETE CASCADE,
  target_event_id TEXT NOT NULL REFERENCES triage_events(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_changes_source_idx ON triage_event_changes(source_event_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_changes_target_idx ON triage_event_changes(target_event_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_event_changes_tenant_user_idx ON triage_event_changes(tenant_id, user_id);
