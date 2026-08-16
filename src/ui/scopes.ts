/**
 * Plain-language readings of each permission scope, for the authorize page's manifest.
 *
 * A scope the visitor cannot read is a scope they cannot meaningfully grant, so every
 * entry names the concrete power in the product's own words. Unknown scopes fall back to
 * their identifier rather than being hidden - never silently omit a granted power.
 */
export const SCOPE_READINGS: Record<string, string> = {
  "mail.read": "Read the messages in your connected mailboxes",
  "mail.search": "Search across your connected mailboxes",
  "mail.modify": "Mark messages read or unread",
  "mail.archive": "Archive messages, never permanently delete them",
  "mail.draft": "Write and edit drafts, held on the server for your review",
  "mail.send": "Send a draft, only after you approve its exact contents",
  "signatures.read": "Read your stored signature profiles",
  "signatures.manage": "Create and edit your signature profiles",
  "relationships.read": "Read who you have marked as client, coworker, recruiter, vendor",
  "relationships.manage": "Update relationships, projects, and sender preferences",
  "profile.read": "Read your Mailwarden profile and rules",
  "profile.manage": "Update your Mailwarden profile and rules",
  "accounts.read": "List which email accounts are connected, and their status",
  "accounts.manage": "Connect and disconnect email accounts",
};

export type ScopeState = "granted" | "approval" | "dryrun";

/** Scopes that mutate remote mailbox state, and so are subject to dry-run mode. */
const MUTATES_MAILBOX = new Set(["mail.modify", "mail.archive"]);

/**
 * The true guard on each scope. Sending is gated on an exact-payload approval regardless
 * of configuration; mailbox mutations are simulated while dry-run is on. Everything else
 * is granted outright - claiming otherwise would overstate the protection.
 */
export function scopeState(scope: string, mutationsEnabled: boolean): ScopeState {
  if (scope === "mail.send") return "approval";
  if (MUTATES_MAILBOX.has(scope) && !mutationsEnabled) return "dryrun";
  return "granted";
}

export const STATE_WORD: Record<ScopeState, string> = {
  granted: "GRANTED",
  approval: "APPROVAL REQUIRED",
  dryrun: "DRY RUN",
};

export function scopeReading(scope: string): string {
  return SCOPE_READINGS[scope] ?? scope;
}
