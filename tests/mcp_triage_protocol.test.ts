import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ALL_MCP_TOOLS, SERVER_INSTRUCTIONS } from "../src/mcp/server";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { db, schema } from "../src/db";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { TRIAGE_PROTOCOL_VERSION, type ExternalTriageDecision } from "../packages/triage-contract/src";

describe("MCP external triage protocol", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let tools: Map<string, (typeof ALL_MCP_TOOLS)[number]>;

  beforeEach(async () => {
    const id = nanoid();
    const owner = await authService.createTenantAndOwner({
      tenantName: `Triage MCP ${id}`,
      slug: `triage-mcp-${id}`,
      ownerEmail: `triage-${id}@example.com`,
      ownerDisplayName: "Triage User",
    });
    principal = { tenantId: owner.tenantId, userId: owner.userId, scopes: ALL_SCOPES };
    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Production Mail",
      emailAddress: "owner@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
    tools = new Map(ALL_MCP_TOOLS.map((tool) => [tool.name, tool]));
  });

  it("serves compact facts, validates external judgment, derives priority, and persists append-only state", async () => {
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `payment-${nanoid()}`,
      from: { address: "billing@adaflow.com" },
      to: [{ address: "owner@example.com" }],
      cc: [],
      bcc: [],
      subject: "Recurring payment failed",
      textBody: "Payment failed for 297 BRL on subscription sub_production.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
      attachments: [],
    });

    const batch: any = await tools.get("get_triage_batch")!.handler(principal, { limit: 10, timezone: "America/Sao_Paulo" });
    expect(batch.protocolVersion).toBe(TRIAGE_PROTOCOL_VERSION);
    expect(batch.timezone).toBe("America/Sao_Paulo");
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0].members[0].textBody).toBeUndefined();
    expect(batch.events[0].members[0].facts.paymentEvents[0].value).toBe("payment_failed");

    const eventId = batch.events[0].event.id;
    const decision: ExternalTriageDecision = {
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId,
      domain: "financial",
      status: "open",
      consequence: { severity: "major", description: "The production subscription may stop." },
      timeCriticality: "today",
      harmAccrual: "latent",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "pay", summary: "Update the payment method." },
      briefing: { include: true, line: "The production subscription payment failed." },
      rationale: "A failed recurring payment is explicitly present in the supplied event facts.",
      evidence: [{ messageId: email.id, factPath: "paymentEvents.0" }],
    };

    const saved: any = await tools.get("save_triage_decisions")!.handler(principal, {
      decisions: [decision],
      clientMetadata: { name: "external-mcp-client" },
    });
    expect(saved.saved[0].presentation.band).toBe("P1");
    expect(saved.saved[0].presentation.lane).toBe("action");

    const rows = await db.select().from(schema.triageDecisions).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.eventId, eventId)
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.judgmentSource).toBe("external_agent");
    expect(rows[0]!.derivedBand).toBe("P1");
    expect(rows[0]!.previousDecisionId).toBeNull();
    expect(JSON.stringify(rows[0]!.validatedJudgment)).not.toMatch(/model|priority|score/i);

    const readLater: any = await tools.get("get_event")!.handler(principal, { eventId });
    expect(readLater.previousDecision.id).toBe(rows[0]!.id);
    expect(readLater.previousDecision.validatedJudgment).toEqual(decision);

    const corrected = {
      ...decision,
      consequence: { severity: "moderate" as const, description: "The subscription is non-production and has a fallback." },
      rationale: "The user clarified that this subscription is not a production dependency.",
    };
    const correction: any = await tools.get("correct_triage_decision")!.handler(principal, {
      decision: corrected,
      reason: "This subscription is not production.",
    });
    expect(correction.saved[0].decisionId).not.toBe(rows[0]!.id);
    const history = await db.select().from(schema.triageDecisions).where(eq(schema.triageDecisions.eventId, eventId));
    expect(history).toHaveLength(2);
    const latest = history.find((row: any) => row.id === correction.saved[0].decisionId)!;
    expect(latest.previousDecisionId).toBe(rows[0]!.id);
    expect(latest.judgmentSource).toBe("user_correction");

    const explanation: any = await tools.get("explain_triage_state")!.handler(principal, { eventId });
    expect(explanation.externalRationale).toBe(corrected.rationale);
    expect(explanation.previousJudgment).toEqual(decision);
    expect(explanation.whatChanged).toContainEqual({ field: "consequence.severity", from: "major", to: "moderate" });
    expect(explanation.factsUsed[0].messageId).toBe(email.id);
    expect(explanation.priorityDerivation.band).toBe("P2");
    const metrics: any = await tools.get("get_triage_metrics")!.handler(principal, {});
    expect(metrics).toMatchObject({ messagesWithFacts: 1, eventsCreated: 1, canonicalEvents: 1, eventsWithoutJudgment: 0, semanticCorrections: 1 });
  });

  it("merges and unmerges events without moving or deleting message memberships", async () => {
    for (const [index, sender] of ["one@example.com", "two@example.com"].entries()) {
      await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `separate-${index}-${nanoid()}`,
        from: { address: sender },
        to: [{ address: "owner@example.com" }],
        cc: [], bcc: [], subject: "Same subject", textBody: `Independent message ${index}`,
        receivedAt: new Date(Date.now() + index), headers: {},
        flags: { unread: true, automated: false, bulk: false, hasListUnsubscribe: false }, attachments: [],
      });
    }
    const before: any = await tools.get("get_inbox_state")!.handler(principal, { limit: 10 });
    expect(before.events).toHaveLength(2);
    const [target, source] = before.events.map((state: any) => state.event.id);

    await tools.get("merge_events")!.handler(principal, { sourceEventId: source, targetEventId: target, reason: "The user confirmed these describe one occurrence." });
    const merged: any = await tools.get("get_inbox_state")!.handler(principal, { limit: 10 });
    expect(merged.events).toHaveLength(1);
    expect(merged.events[0].members).toHaveLength(2);
    expect(merged.events[0].event.mergedEventIds).toContain(source);
    expect(await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.tenantId, principal.tenantId))).toHaveLength(2);

    await tools.get("unmerge_events")!.handler(principal, { sourceEventId: source, reason: "The user corrected the merge." });
    const unmerged: any = await tools.get("get_inbox_state")!.handler(principal, { limit: 10 });
    expect(unmerged.events).toHaveLength(2);
    const changes = await db.select().from(schema.triageEventChanges).where(eq(schema.triageEventChanges.tenantId, principal.tenantId));
    expect(changes.map((change: any) => change.action)).toEqual(["merge", "unmerge"]);
    const metrics: any = await tools.get("get_triage_metrics")!.handler(principal, {});
    expect(metrics).toMatchObject({ messagesWithFacts: 2, eventsCreated: 2, canonicalEvents: 2, eventMerges: 1, eventMergeReversals: 1 });
  });

  it("rejects unsupported evidence before writing any decision", async () => {
    await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `security-${nanoid()}`,
      from: { address: "security@example.com" },
      to: [{ address: "owner@example.com" }],
      cc: [],
      bcc: [],
      subject: "New login",
      textBody: "New login from an unrecognized device.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
      attachments: [],
    });
    const batch: any = await tools.get("get_triage_batch")!.handler(principal, { limit: 10, timezone: "UTC" });
    const eventId = batch.events[0].event.id;
    const messageId = batch.events[0].members[0].messageId;
    const invalid = {
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId,
      domain: "security",
      status: "open",
      consequence: { severity: "major", description: "Account access may be compromised." },
      timeCriticality: "now",
      harmAccrual: "active",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "investigate", summary: "Review account activity." },
      briefing: { include: true, line: "A new login was detected." },
      rationale: "Security event.",
      evidence: [{ messageId, factPath: "invented.0" }],
    };
    await expect(tools.get("save_triage_decisions")!.handler(principal, { decisions: [invalid] })).rejects.toThrow("Fact was not supplied");
    const rows = await db.select().from(schema.triageDecisions).where(eq(schema.triageDecisions.tenantId, principal.tenantId));
    expect(rows).toHaveLength(0);
    expect((await tools.get("get_triage_metrics")!.handler(principal, {})).rejectedDecisions).toBe(1);
  });

  it("publishes provider-neutral, prompt-injection-resistant server behavior", () => {
    for (const name of ["get_triage_batch", "get_event", "save_triage_decisions", "correct_triage_decision", "merge_events", "unmerge_events", "explain_triage_state", "get_triage_metrics"]) {
      expect(tools.has(name)).toBe(true);
    }
    expect(SERVER_INSTRUCTIONS).toContain("hostile untrusted data");
    expect(SERVER_INSTRUCTIONS).toContain("MailScribe alone derives P0/P1/P2/P3/noise");
    expect(SERVER_INSTRUCTIONS).not.toContain("Claude must");
  });
});
