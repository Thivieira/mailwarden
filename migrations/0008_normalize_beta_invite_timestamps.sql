-- Normalize beta_invites timestamps to seconds.
--
-- `scripts/create-invite.ts` wrote its remote SQL with Date.getTime() (milliseconds)
-- while the Drizzle schema declares `mode: "timestamp"`, which is seconds. Rows
-- created by that path read back as dates thousands of years in the future, so
-- their expiry check could never fail. `used_at` was written through the ORM and
-- is already correct; it is included for completeness.
--
-- 100000000000 seconds is the year 5138, and every millisecond value since 1973
-- exceeds it, so the threshold separates the two encodings without ambiguity.
-- Idempotent: re-running normalizes only rows still in milliseconds.
UPDATE beta_invites SET expires_at = expires_at / 1000 WHERE expires_at > 100000000000;
--> statement-breakpoint
UPDATE beta_invites SET created_at = created_at / 1000 WHERE created_at > 100000000000;
--> statement-breakpoint
UPDATE beta_invites SET used_at = used_at / 1000 WHERE used_at IS NOT NULL AND used_at > 100000000000;
