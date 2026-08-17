/**
 * Permissions as doors, in the words a non-technical person already uses.
 *
 * PRODUCT.md sets the baseline: assume the reader has never heard of OAuth, scopes, or
 * tokens. A permission someone cannot read is a permission they cannot meaningfully
 * grant, so the raw identifiers never reach the page - they are grouped into the small
 * number of real powers a person actually cares about.
 */

export type Door = {
  /** What the key opens, in one plain sentence. */
  opens: string;
  /** Lucide icon name for this power. Drawn in parts.tsx; keep the two in step. */
  icon: string;
  /** The scopes this line covers, so the grouping stays auditable against ALL_SCOPES. */
  scopes: string[];
  /** True when this door is only simulated while mailbox mutations are switched off. */
  simulatedWhenDryRun?: boolean;
  /** A short qualifier printed under the line, where the truth needs one. */
  note?: string;
};

const DOORS: Door[] = [
  {
    opens: "Read and search your email",
    icon: "mail-open",
    scopes: ["mail.read", "mail.search"],
  },
  {
    opens: "Write draft replies for you to look at",
    icon: "pen-line",
    scopes: ["mail.draft"],
    note: "Drafts stay on your side. Nothing is sent by writing one.",
  },
  {
    opens: "Send a reply, only after you read it and say yes",
    icon: "send",
    scopes: ["mail.send"],
    note: "Change a single word and your approval no longer counts. You approve again.",
  },
  {
    opens: "Move emails out of your inbox",
    icon: "archive",
    scopes: ["mail.archive"],
    simulatedWhenDryRun: true,
    note: "Moved, never deleted. You can always find them again.",
  },
  {
    opens: "Mark emails as read or unread",
    icon: "eye",
    scopes: ["mail.modify"],
    simulatedWhenDryRun: true,
  },
  {
    opens: "Remember your preferences, your rules, and who people are to you",
    icon: "bookmark",
    scopes: [
      "relationships.read",
      "relationships.manage",
      "profile.read",
      "profile.manage",
      "signatures.read",
      "signatures.manage",
    ],
    note: "Things like “anything from this client is important”, and your signatures.",
  },
  {
    opens: "See and change which email accounts are connected",
    icon: "at-sign",
    scopes: ["accounts.read", "accounts.manage"],
  },
];

/**
 * What the key never opens. Every line here is a guarantee the server enforces in code,
 * not a promise about behaviour - see the invariants in docs/MAILWARDEN_SPEC.md.
 */
export const SHUT_DOORS: string[] = [
  "Delete an email. Mailwarden moves mail; it never permanently deletes it.",
  "Send anything you have not read and approved word for word.",
  "Hand over your Gmail, Outlook, or Proton password. It never has those to give.",
  "Reach anyone else’s email, or let anyone else reach yours.",
];

/** The doors covered by the scopes actually being requested, in reading order. */
export function doorsFor(requested: string[]): Door[] {
  const asked = new Set(requested);
  return DOORS.filter((door) => door.scopes.some((scope) => asked.has(scope)));
}

/**
 * Scopes no door accounts for. Never silently drop a granted power: if the catalog grows
 * and this file is not updated, the leftovers are printed rather than hidden.
 */
export function uncoveredScopes(requested: string[]): string[] {
  const covered = new Set(DOORS.flatMap((door) => door.scopes));
  return requested.filter((scope) => !covered.has(scope));
}
