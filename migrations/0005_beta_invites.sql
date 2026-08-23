CREATE TABLE IF NOT EXISTS beta_invites (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  created_by_user_id TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_user_id TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS beta_invites_code_idx ON beta_invites(code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS beta_invites_email_idx ON beta_invites(email);
