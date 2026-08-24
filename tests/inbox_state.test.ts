import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRIAGE_PROTOCOL_VERSION, type ExternalTriageDecision } from "../packages/triage-contract/src";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { inboxStateService } from "../src/services/inbox-state";
import { triageService } from "../src/services/triage";
import { db, schema } from "../src/db";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";

describe("canonical inbox state", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const owner = await authService.createTenantAndOwner({
      tenantName: `Inbox State ${id}`,
      slug: `inbox-state-${id}`,
      ownerEmail: `state-${id}@example.com`,
      ownerDisplayName: "State User",
    });
    principal = { tenantId: owner.tenantId, userId: owner.userId, scopes: ALL_SCOPES };
    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Inbox",
      emailAddress: "user@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  async function ingest(providerMessageId: string, subject: string, textBody: string, providerThreadId?: string) {
    return emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId,
      providerThreadId,
      from: { address: "billing@example.com" },
      to: [{ address: "user@example.com" }],
      cc: [],
      bcc: [],
      subject,
      textBody,
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
      attachments: [],
    });
  }

  function paymentDecision(eventId: string, messageId: string): ExternalTriageDecision {
    return {
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId,
      domain: "financial",
      status: "open",
      consequence: { severity: "major", description: "The subscription may stop." },
      timeCriticality: "today",
      harmAccrual: "latent",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "pay", summary: "Update payment." },
      briefing: { include: true, line: "Payment failed." },
      rationale: "The payment failure is explicit.",
      evidence: [{ messageId, factPath: "paymentEvents.0" }],
    };
  }

  it("serves one authoritative action state and suppresses it when trusted resolution arrives", async () => {
    const failed = await ingest("state-failed", "Payment failed", "Payment failed for subscription sub_state.");
    const [member] = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.emailId, failed.id)).limit(1);
    await triageService.saveDecisions(principal, [paymentDecision(member!.eventId, failed.id)]);

    let state = await inboxStateService.getInboxState(principal);
    expect(state.totals.actionRequired).toBe(1);
    expect(state.actionQueue[0]!.presentation!.band).toBe("P1");
    expect(state.events[0]!.needsReevaluation).toBe(false);

    await ingest("state-paid", "Payment succeeded", "Payment succeeded for subscription sub_state. Receipt attached.");
    state = await inboxStateService.getInboxState(principal);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.needsReevaluation).toBe(true);
    expect(state.events[0]!.staleReasons).toContain("event_status_changed");
    expect(state.events[0]!.presentation!.band).toBe("noise");
    expect(state.totals.actionRequired).toBe(0);

    const decisions = await db.select().from(schema.triageDecisions).where(eq(schema.triageDecisions.eventId, member!.eventId));
    expect(decisions).toHaveLength(1);
    expect((decisions[0]!.validatedJudgment as any).status).toBe("open");
  });

  it("recomputes credential expiry from injected time and marks the decision stale without inference", async () => {
    const receivedAt = new Date();
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: "state-otp",
      from: { address: "login@example.com" },
      to: [{ address: "user@example.com" }],
      cc: [],
      bcc: [],
      subject: "Verification code 849201",
      textBody: "Your verification code is 849201 and expires in 10 minutes.",
      receivedAt,
      headers: {},
      flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
      attachments: [],
    });
    const [member] = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.emailId, email.id)).limit(1);
    const decision: ExternalTriageDecision = {
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId: member!.eventId,
      domain: "account",
      status: "open",
      consequence: { severity: "moderate", description: "The login cannot complete without the code." },
      timeCriticality: "now",
      harmAccrual: "latent",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "verify", summary: "Enter the code." },
      briefing: { include: false },
      rationale: "A live code is present.",
      evidence: [{ messageId: email.id, factPath: "credentials.0" }],
    };
    await triageService.saveDecisions(principal, [decision]);
    const state = await inboxStateService.getInboxState(principal, { now: new Date(receivedAt.getTime() + 20 * 60 * 1_000) });
    expect(state.events[0]!.staleReasons).toContain("credential_expired");
    expect(state.events[0]!.presentation!.band).toBe("noise");
    expect(state.events[0]!.presentation!.safeActionTarget).toBe(false);
  });

  it("validates HTTP-originated limits at the service boundary", async () => {
    await expect(inboxStateService.getInboxState(principal, { limit: Number.NaN })).rejects.toThrow("positive integer");
  });
});
