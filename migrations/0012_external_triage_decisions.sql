-- Append-only, provider-neutral L3 judgment and L4 presentation state.
CREATE TABLE IF NOT EXISTS triage_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES triage_events(id) ON DELETE CASCADE,
  protocol_version TEXT NOT NULL,
  facts_version TEXT NOT NULL,
  uoc_version TEXT NOT NULL DEFAULT '0',
  judgment_source TEXT NOT NULL,
  external_judgment TEXT NOT NULL,
  validated_judgment TEXT NOT NULL,
  clamps_applied TEXT NOT NULL DEFAULT '[]',
  derived_band TEXT NOT NULL,
  derived_urgency TEXT NOT NULL,
  lane TEXT NOT NULL,
  inconsistent INTEGER NOT NULL DEFAULT 0,
  safe_action_target INTEGER NOT NULL DEFAULT 1,
  review_flags TEXT NOT NULL DEFAULT '[]',
  needs_reevaluation INTEGER NOT NULL DEFAULT 0,
  previous_decision_id TEXT,
  correction_state TEXT NOT NULL DEFAULT 'none',
  correction_reason TEXT,
  client_metadata TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_decisions_event_idx ON triage_decisions(event_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_decisions_tenant_user_idx ON triage_decisions(tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_decisions_stale_idx ON triage_decisions(tenant_id, user_id, needs_reevaluation);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS triage_decisions_band_idx ON triage_decisions(tenant_id, user_id, derived_band);
