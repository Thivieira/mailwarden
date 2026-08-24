import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { extractFeatures, type TriageFeatureMessage } from "../packages/triage-features/src";
import { deriveEventIdentity, type EventIdentityMessage } from "../packages/triage-events/src";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { db, schema } from "../src/db";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function identity(overrides: Partial<EventIdentityMessage> & Pick<EventIdentityMessage, "providerMessageId" | "from" | "subject" | "textBody">) {
  const message: EventIdentityMessage & TriageFeatureMessage = {
    accountId: "account-1",
    provider: "mock",
    receivedAt: NOW,
    to: [{ address: "user@example.com" }],
    headers: {},
    ...overrides,
  };
  return deriveEventIdentity(message, extractFeatures(message, NOW));
}

function sharedKey(a: ReturnType<typeof identity>, b: ReturnType<typeof identity>): string | undefined {
  const right = new Set(b.keys.map((key) => key.value));
  return a.keys.find((key) => right.has(key.value))?.value;
}

describe("deterministic event identity", () => {
  it("clusters duplicate Adaflow notifications by thread evidence", () => {
    const first = identity({ providerMessageId: "ada-1", providerThreadId: "payment-297", from: { address: "billing@adaflow.com" }, subject: "Payment failed", textBody: "Payment failed for 297 BRL." });
    const duplicate = identity({ providerMessageId: "ada-2", providerThreadId: "payment-297", from: { address: "processor@adaflow.com" }, subject: "Payment failed", textBody: "Payment failed for 297 BRL." });
    expect(sharedKey(first, duplicate)).toBe("provider-thread|account-1|payment-297");
  });

  it("clusters a GitHub PR lifecycle and observes the merged state", () => {
    const opened = identity({ providerMessageId: "gh-1", from: { address: "notifications@github.com" }, subject: "PR #52 opened", textBody: "GitHub pull request #52 opened in foxdev/mailwarden." });
    const pushed = identity({ providerMessageId: "gh-2", from: { address: "notifications@github.com" }, subject: "PR #52 updated", textBody: "GitHub pull request #52 updated in foxdev/mailwarden." });
    const merged = identity({ providerMessageId: "gh-3", from: { address: "notifications@github.com" }, subject: "PR #52 merged", textBody: "GitHub pull request #52 merged in foxdev/mailwarden." });
    expect(opened.primaryKey).toBe("github|foxdev/mailwarden|pr|52");
    expect(sharedKey(opened, pushed)).toBe(opened.primaryKey);
    expect(sharedKey(opened, merged)).toBe(opened.primaryKey);
    expect(merged.observedState).toBe("resolved");
  });

  it("clusters the same Jira issue but separates different issues", () => {
    const first = identity({ providerMessageId: "jira-1", from: { address: "jira@example.com" }, subject: "SKAFE-123 updated", textBody: "Issue SKAFE-123 changed." });
    const second = identity({ providerMessageId: "jira-2", from: { address: "jira@example.com" }, subject: "SKAFE-123 overdue", textBody: "Issue SKAFE-123 is overdue." });
    const other = identity({ providerMessageId: "jira-3", from: { address: "jira@example.com" }, subject: "SKAFE-124 overdue", textBody: "Issue SKAFE-124 is overdue." });
    expect(sharedKey(first, second)).toBe("jira|SKAFE-123");
    expect(sharedKey(first, other)).toBeUndefined();
  });

  it("never merges on subject or amount alone", () => {
    const subjectA = identity({ providerMessageId: "same-1", from: { address: "one@example.com" }, subject: "Status update", textBody: "News." });
    const subjectB = identity({ providerMessageId: "same-2", from: { address: "two@example.com" }, subject: "Status update", textBody: "News." });
    const amountA = identity({ providerMessageId: "amt-1", from: { address: "one@vendor-a.com" }, subject: "Receipt", textBody: "Receipt for 297 BRL." });
    const amountB = identity({ providerMessageId: "amt-2", from: { address: "two@vendor-b.com" }, subject: "Receipt", textBody: "Receipt for 297 BRL." });
    expect(sharedKey(subjectA, subjectB)).toBeUndefined();
    expect(sharedKey(amountA, amountB)).toBeUndefined();
  });
});

describe("persistent event membership", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const owner = await authService.createTenantAndOwner({
      tenantName: `Event Org ${id}`,
      slug: `event-org-${id}`,
      ownerEmail: `event-${id}@example.com`,
      ownerDisplayName: "Event User",
    });
    principal = { tenantId: owner.tenantId, userId: owner.userId, scopes: ALL_SCOPES };
    accountId = nanoid();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Event Mailbox",
      emailAddress: "event@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("persists facts and two messages as one event without destroying message identity", async () => {
    for (const [providerMessageId, subject] of [["jira-a", "SKAFE-123 updated"], ["jira-b", "SKAFE-123 overdue"]]) {
      await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: providerMessageId!,
        from: { address: "jira@example.com" },
        to: [{ address: "event@example.com" }],
        cc: [],
        bcc: [],
        subject: subject!,
        textBody: `Issue ${subject}.`,
        receivedAt: NOW,
        headers: {},
        flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
        attachments: [],
      });
    }

    const events = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    ));
    const members = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.eventId, events[0]!.id));
    const facts = await db.select().from(schema.messageFacts).where(eq(schema.messageFacts.tenantId, principal.tenantId));
    const messages = await db.select().from(schema.emails).where(eq(schema.emails.tenantId, principal.tenantId));

    expect(events).toHaveLength(1);
    expect(events[0]!.messageCount).toBe(2);
    expect(members).toHaveLength(2);
    expect(facts).toHaveLength(2);
    expect(messages).toHaveLength(2);
  });
});
