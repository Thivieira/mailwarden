CREATE TABLE identity_email_claims (
  email TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);--> statement-breakpoint

INSERT OR IGNORE INTO identity_email_claims (email, user_id, created_at)
SELECT lower(email), id, created_at FROM users ORDER BY created_at ASC;
