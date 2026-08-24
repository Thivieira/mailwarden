import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRIAGE_PROTOCOL_VERSION, type ExternalTriageDecision } from "../packages/triage-contract/src";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { triageService } from "../src/services/triage";
import { db, schema } from "../src/db";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";

describe("structured user operating context", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const owner = await authService.createTenantAndOwner({
      tenantName: `UOC Org ${id}`,
      slug: `uoc-${id}`,
      ownerEmail: `uoc-${id}@example.com`,
      ownerDisplayName: "UOC User",
    });
    principal = { tenantId: owner.tenantId, userId: owner.userId, scopes: ALL_SCOPES };
    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Work",
      emailAddress: "user@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("reuses existing context and adds only structured services and commitments", async () => {
    const before = await triageService.getUserOperatingContext(principal);
    const service = await triageService.setUserService(principal, {
      name: "Railway Postgres",
      provider: "Railway",
      environment: "production",
      domains: ["api.example.com"],
      accountIds: [accountId],
      notes: "Primary production database",
    });
    const commitment = await triageService.setUserCommitment(principal, {
      kind: "subscription",
      name: "Railway production plan",
      counterparty: "Railway",
      amountMinor: 2000,
      currency: "usd",
      dueAt: "2026-08-27T12:00:00.000Z",
      relatedServiceId: service!.id,
    });
    const after = await triageService.getUserOperatingContext(principal);

    expect(after.version).not.toBe(before.version);
    expect(after.services[0]!.environment).toBe("production");
    expect(after.commitments[0]!.relatedServiceId).toBe(service!.id);
    expect(commitment!.currency).toBe("USD");
    expect(after).not.toHaveProperty("policies");
  });

  it("stores the exact UOC version and marks decisions stale after material context change", async () => {
    const service = await triageService.setUserService(principal, {
      name: "Adaflow",
      environment: "production",
      accountIds: [accountId],
    });
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `uoc-payment-${nanoid()}`,
      from: { address: "billing@adaflow.com" },
      to: [{ address: "user@example.com" }],
      cc: [],
      bcc: [],
      subject: "Payment failed",
      textBody: "Payment failed for 297 BRL.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, automated: true, bulk: false, hasListUnsubscribe: false },
      attachments: [],
    });
    const [member] = await db.select().from(schema.triageEventMembers).where(eq(schema.triageEventMembers.emailId, email.id)).limit(1);
    const uoc = await triageService.getUserOperatingContext(principal);
    const decision: ExternalTriageDecision = {
      protocolVersion: TRIAGE_PROTOCOL_VERSION,
      eventId: member!.eventId,
      domain: "financial",
      status: "open",
      consequence: { severity: "major", description: "Production access may stop." },
      timeCriticality: "today",
      harmAccrual: "latent",
      actionRequired: true,
      actor: "user",
      waitingOn: "user",
      action: { kind: "pay", summary: "Update payment." },
      briefing: { include: true, line: "Adaflow payment failed." },
      rationale: "Failed payment plus a production service context record.",
      evidence: [{ messageId: email.id, factPath: "paymentEvents.0" }],
      contextReferences: [{ kind: "service", id: service!.id }],
    };
    await triageService.saveDecisions(principal, [decision]);
    let [stored] = await db.select().from(schema.triageDecisions).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.eventId, member!.eventId)
    )).limit(1);
    expect(stored!.uocVersion).toBe(uoc.version);
    expect(stored!.needsReevaluation).toBe(false);

    await triageService.setUserService(principal, {
      id: service!.id,
      name: "Adaflow",
      environment: "staging",
      accountIds: [accountId],
    });
    [stored] = await db.select().from(schema.triageDecisions).where(eq(schema.triageDecisions.id, stored!.id)).limit(1);
    expect(stored!.needsReevaluation).toBe(true);
    expect((await triageService.getUserOperatingContext(principal)).version).not.toBe(uoc.version);
  });

  it("rejects context links to accounts outside the user boundary", async () => {
    await expect(triageService.setUserService(principal, {
      name: "Unauthorized",
      environment: "production",
      accountIds: ["other-user-account"],
    })).rejects.toThrow("unknown or unauthorized");
  });
});
