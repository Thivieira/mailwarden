import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRIAGE_PROTOCOL_VERSION } from "../packages/triage-contract/src";
import { db, schema } from "../src/db";
import { attentionService } from "../src/services/attention";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { triageService } from "../src/services/triage";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";

describe("Search and canonical inbox intelligence", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Intel Org ${id}`,
      slug: `intel-org-${id}`,
      ownerEmail: `analyst-${id}@company.com`,
      ownerDisplayName: "Analyst",
    });
    principal = { tenantId: created.tenantId, userId: created.userId, scopes: ALL_SCOPES };
    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Analyst Mailbox",
      emailAddress: "analyst@company.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("ingests evidence-bearing facts and events without writing legacy semantic classifications", async () => {
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_inv_${nanoid()}`,
      from: { address: "billing@vendor.com" },
      to: [{ address: "analyst@company.com" }],
      cc: [], bcc: [], subject: "Invoice in_9021 is due",
      textBody: "Invoice is due on August 27 for 1,200 USD.",
      receivedAt: new Date("2026-08-24T12:00:00.000Z"), headers: {},
      flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false }, attachments: [],
    });
    const [facts] = await db.select().from(schema.messageFacts).where(eq(schema.messageFacts.emailId, email.id));
    expect((facts!.facts as any).paymentEvents[0].value).toBe("payment_due");
    expect((facts!.facts as any).paymentEvents[0].evidence[0].text).toBeTruthy();
    expect((facts!.facts as any).entityIds.some((fact: any) => fact.value.id === "in_9021")).toBe(true);
    expect(await db.select().from(schema.classifications).where(eq(schema.classifications.emailId, email.id))).toHaveLength(0);
  });

  it("searches email with structured filters", async () => {
    await emailService.ingestEmail(principal, {
      accountId, provider: "mock", providerMessageId: `msg_s1_${nanoid()}`,
      from: { address: "dev@company.com" }, to: [{ address: "analyst@company.com" }], cc: [], bcc: [],
      subject: "Kubernetes cluster migration report", textBody: "Migration finished successfully with zero downtime.",
      receivedAt: new Date(), headers: {},
      flags: { unread: false, bulk: false, automated: false, hasListUnsubscribe: false }, attachments: [],
    });
    expect((await emailService.searchMail(principal, { query: "Kubernetes" })).total).toBe(1);
    expect((await emailService.searchMail(principal, { query: "Kubernetes", unreadOnly: true })).total).toBe(0);
  });

  it("expires only real credentials while preserving an aged security event", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const otp = await emailService.ingestEmail(principal, {
      accountId, provider: "mock", providerMessageId: `msg_otp_${nanoid()}`,
      from: { address: "no-reply@substack.com" }, to: [{ address: "analyst@company.com" }], cc: [], bcc: [],
      subject: "Your login verification code: 849201", textBody: "Your verification code is 849201. It expires in 10 minutes.",
      receivedAt: twoHoursAgo, headers: {},
      flags: { unread: false, bulk: false, automated: true, hasListUnsubscribe: false }, attachments: [],
    });
    const alert = await emailService.ingestEmail(principal, {
      accountId, provider: "mock", providerMessageId: `msg_sec_${nanoid()}`,
      from: { address: "noreply@cloudflare.com" }, to: [{ address: "analyst@company.com" }], cc: [], bcc: [],
      subject: "Security alert: certificate issued", textBody: "A certificate was issued after a new login from an unrecognized device.",
      receivedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), headers: {},
      flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false }, attachments: [],
    });
    const [otpMember] = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.emailId, otp.id));
    const [alertMember] = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.emailId, alert.id));
    const otpContext: any = await triageService.getEventContext(principal, otpMember!.eventId);
    const alertContext: any = await triageService.getEventContext(principal, alertMember!.eventId);
    expect(otpContext.members[0].facts.credentials[0].value.expirationState).toBe("expired");
    expect(alertContext.members[0].facts.credentials).toEqual([]);
    expect(alertContext.members[0].facts.securityEvents.length).toBeGreaterThan(0);

    await triageService.saveDecisions(principal, [{
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId: alertMember!.eventId,
      domain: "security",
      status: "open",
      consequence: { severity: "major", description: "Unexpected account access may compromise the service." },
      timeCriticality: "now",
      harmAccrual: "active",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "investigate", summary: "Review the login and certificate activity." },
      briefing: { include: true, line: "Unexpected login and certificate activity was detected." },
      rationale: "The supplied facts contain a structurally detected login and certificate event.",
      evidence: [{ messageId: alert.id, factPath: "securityEvents.0" }],
    }]);
    const status = await attentionService.getInboxStatus(principal);
    expect(status.totals.important).toBe(1);
    expect(status.totals.actionRequired).toBe(1);
    const queued = (await attentionService.getAttentionQueue(principal, { limit: 50, minScore: 0 })).find((item) => item.messageId === alert.id);
    expect(queued?.importance).toMatch(/critical|high/);
  });

  it("derives status and compatibility queue from the same event state", async () => {
    for (const subject of ["Contract renewal proposal", "Weekly digest", "Invoice #4410 available"]) {
      await emailService.ingestEmail(principal, {
        accountId, provider: "mock", providerMessageId: `msg_mix_${nanoid()}`,
        from: { address: "ops@vendor.com" }, to: [{ address: "analyst@company.com" }], cc: [], bcc: [],
        subject, textBody: `${subject} body text.`, receivedAt: new Date(), headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false }, attachments: [],
      });
    }
    const status = await attentionService.getInboxStatus(principal);
    const queue = await attentionService.getAttentionQueue(principal, { limit: 100, minScore: 0 });
    expect(status.totals.needsAttention).toBeLessThanOrEqual(queue.length);
    expect(status.totals.actionRequired + status.totals.routine).toBeLessThanOrEqual(queue.length);
  });

  it("computes unread counts from provider truth", async () => {
    await emailService.ingestEmail(principal, {
      accountId, provider: "mock", providerMessageId: `msg_unread_${nanoid()}`,
      from: { address: "boss@foxdevstudio.com" }, to: [{ address: "analyst@company.com" }], cc: [], bcc: [],
      subject: "Roadmap review", textBody: "Please review the roadmap.", receivedAt: new Date(), headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false }, attachments: [],
    });
    const account = (await attentionService.getInboxStatus(principal)).accounts.find((item) => item.id === accountId);
    expect(account?.unreadCount).toBeGreaterThanOrEqual(1);
  });
});
