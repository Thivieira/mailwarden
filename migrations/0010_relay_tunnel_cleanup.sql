-- Ledger of managed tunnel resources that could not be released.
--
-- Deleting a Cloudflare tunnel and deleting its DNS record are separate external
-- calls, and local revocation is authoritative: a Cloudflare outage must never
-- keep a revoked device published. That trade leaves resources behind, so each
-- failed release is recorded here and retried by the reconciliation pass instead
-- of accumulating silently.
CREATE TABLE IF NOT EXISTS relay_tunnel_cleanup (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tunnel_id TEXT NOT NULL,
  hostname TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT,
  released_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS relay_tunnel_cleanup_tunnel_idx ON relay_tunnel_cleanup(tunnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS relay_tunnel_cleanup_pending_idx ON relay_tunnel_cleanup(released_at, last_attempt_at);
