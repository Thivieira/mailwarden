import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { policyService } from "../src/services/policy";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { config } from "../src/config";

describe("Complete Dry Run Simulation Mode Across All Actions", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `DryRun Org ${id}`,
      slug: `dryrun-${id}`,
      ownerEmail: `user-${id}@example.com`,
      ownerDisplayName: "DryRun User",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
    };

    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "DryRun Mailbox",
      emailAddress: "dryrun@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Executes the real policy pipeline and simulates archive (POLICY_WOULD_ARCHIVE)", async () => {
    await policyService.setPolicy(principal, {
      name: "Archive Promos",
      scope: "sender",
      targetValue: "promo@store.com",
      action: "archive",
      minimumConfidence: 80,
    });

    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_dry_arch_${nanoid()}`,
      from: { address: "promo@store.com" },
      to: [{ address: "dryrun@example.com" }],
      cc: [],
      bcc: [],
      subject: "50% Off Everything Today Only",
      textBody: "Big sale on all items.",
      receivedAt: new Date(),
      headers: { "list-unsubscribe": "<mailto:unsub@store.com>" },
      flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
      attachments: [],
    });

    // Verify mailbox action was logged as simulated
    const [action] = await db
      .select()
      .from(schema.mailboxActions)
      .where(eq(schema.mailboxActions.messageId, email.id));

    expect(action).toBeDefined();
    expect(action!.status).toBe("simulated");
    expect(action!.action).toBe("archive");

    // Verify audit event
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, email.id));

    expect(audits.some((a: any) => a.action === "POLICY_WOULD_ARCHIVE")).toBe(true);

    // Verify explanation context
    const explanation = await policyService.explainPolicyDecision(principal, email.id);
    expect(explanation.simulated).toBe(true);
    expect(explanation.action).toBe("archive");
    expect(explanation.explanation).toContain("Archive Promos");
  });

  it("Simulates mark_read, keep_unread, label, move, delete, surface, prioritize, and leave", async () => {
    const testCases: Array<{
      action: "mark_read" | "keep_unread" | "label" | "move" | "delete" | "surface" | "prioritize" | "leave";
      destination?: string;
      expectedAudit: string;
    }> = [
      { action: "mark_read", expectedAudit: "POLICY_WOULD_MARK_READ" },
      { action: "keep_unread", expectedAudit: "POLICY_WOULD_KEEP_UNREAD" },
      { action: "label", destination: "Finance", expectedAudit: "POLICY_WOULD_LABEL" },
      { action: "move", destination: "Invoices", expectedAudit: "POLICY_WOULD_MOVE" },
      { action: "delete", expectedAudit: "POLICY_WOULD_DELETE" }, // Explicit user custom rule in dry-run logs WOULD_DELETE
      { action: "surface", expectedAudit: "POLICY_WOULD_SURFACE" },
      { action: "prioritize", expectedAudit: "POLICY_WOULD_PRIORITIZE" },
      { action: "leave", expectedAudit: "POLICY_WOULD_LEAVE" },
    ];

    for (const tc of testCases) {
      const sender = `sender_${tc.action}@example.com`;
      await policyService.setPolicy(principal, {
        name: `Rule for ${tc.action}`,
        scope: "sender",
        targetValue: sender,
        action: tc.action,
        destination: tc.destination,
        minimumConfidence: 70,
      });

      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${tc.action}_${nanoid()}`,
        from: { address: sender },
        to: [{ address: "dryrun@example.com" }],
        cc: [],
        bcc: [],
        subject: `Testing ${tc.action}`,
        textBody: `Message body for ${tc.action}`,
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });

      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceId, email.id));

      expect(audits.some((a: any) => a.action === tc.expectedAudit)).toBe(true);

      const exp = await policyService.explainPolicyDecision(principal, email.id);
      expect(exp.simulated).toBe(true);
      if (tc.destination) {
        expect(exp.destination).toBe(tc.destination);
      }
    }
  });
});
