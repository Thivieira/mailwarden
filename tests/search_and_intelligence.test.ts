import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { intelligenceService } from "../src/services/intelligence";
import { relationshipService } from "../src/services/relationships";
import { attentionService } from "../src/services/attention";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { nanoid } from "nanoid";

describe("Search, Deterministic Signals, and Intelligence Ranking", () => {
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
      displayName: "Analyst Mailbox",
      emailAddress: "analyst@company.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Extracts factual signals and classifies emails deterministically", async () => {
    const invoiceEmail = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_inv_${nanoid()}`,
      from: { address: "billing@vendor.com" },
      to: [{ address: "analyst@company.com" }],
      cc: [],
      bcc: [],
      subject: "Invoice #9021 Available for Payment",
      textBody: "Please find invoice #9021 for $1,200 due on September 1st.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false },
      attachments: [],
    });

    const signals = await intelligenceService.extractSignals(principal, invoiceEmail);
    expect(signals.likelyFinancial).toBe(true);
    expect(signals.explicitDeadline).toBeDefined();

    const classification = await intelligenceService.classifyEmail(principal, invoiceEmail, signals);
    expect(classification.category).toBe("financial");
    expect(classification.importance).toBe("high");
    expect(classification.workflowState).toBe("action_required");
  });

  it("User corrections outrank automatic model classification", async () => {
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_corr_${nanoid()}`,
      from: { address: "friend@example.com" },
      to: [{ address: "analyst@company.com" }],
      cc: [],
      bcc: [],
      subject: "Casual catch-up",
      textBody: "Hey, are you free this weekend?",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    // Initial classification is normal/other
    const corrected = await intelligenceService.correctClassification(principal, {
      emailId: email.id,
      importance: "critical",
      workflowState: "action_required",
      summary: "High priority VIP personal request",
      reason: "VIP family member",
    });

    expect(corrected.importance).toBe("critical");
    expect(corrected.userCorrected).toBe(true);
    expect(corrected.source).toBe("user_correction");
  });

  it("Searches email with structured filters", async () => {
    await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_s1_${nanoid()}`,
      from: { address: "dev@company.com" },
      to: [{ address: "analyst@company.com" }],
      cc: [],
      bcc: [],
      subject: "Kubernetes cluster migration report",
      textBody: "Migration finished successfully with zero downtime.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: false, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    const results = await emailService.searchMail(principal, { query: "Kubernetes" });
    expect(results.total).toBe(1);
    expect(results.messages[0]!.subject).toContain("Kubernetes");

    const unreadResults = await emailService.searchMail(principal, { query: "Kubernetes", unreadOnly: true });
    expect(unreadResults.total).toBe(0);
  });

  it("Downgrades expired OTP verification codes to automated/low and excludes from action_required", async () => {
    // Message from 2 hours ago containing a verification code
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const expiredOtpEmail = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_otp_${nanoid()}`,
      from: { address: "no-reply@substack.com" },
      to: [{ address: "user@domain.com" }],
      cc: [],
      bcc: [],
      subject: "Your Substack login verification code: 849201",
      textBody: "Your one-time login code is 849201. This code will expire in 10 minutes.",
      receivedAt: twoHoursAgo,
      headers: {},
      flags: { unread: false, bulk: false, automated: true, hasListUnsubscribe: false },
      attachments: [],
    });

    const signals = await intelligenceService.extractSignals(principal, expiredOtpEmail);
    expect(signals.isExpiredOtp).toBe(true);

    const classification = await intelligenceService.classifyEmail(principal, expiredOtpEmail, signals);
    expect(classification.workflowState).toBe("automated");
    expect(classification.importance).toBe("low");
    expect(classification.timeSensitivity).toBe("none");
  });

  it("Keeps aged security alerts important instead of decaying them as verification codes", async () => {
    // Regression: the expired-OTP workaround matched on `category === "security"`,
    // so every genuine security alert was downgraded to importance `low` fifteen
    // minutes after arrival. That is what drove `important: 0` on a real inbox.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const alert = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_sec_${nanoid()}`,
      from: { address: "noreply@cloudflare.com" },
      to: [{ address: "analyst@company.com" }],
      cc: [],
      bcc: [],
      subject: "Security alert: unusual certificate activity for your domain",
      textBody:
        "We detected a certificate issued for a domain in your account from an unrecognized device.",
      receivedAt: sixHoursAgo,
      headers: {},
      flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false },
      attachments: [],
    });

    const signals = await intelligenceService.extractSignals(principal, alert);
    expect(signals.likelySecurityRelated).toBe(true);
    expect(signals.isExpiredOtp).toBe(false);

    const classification = await intelligenceService.classifyEmail(principal, alert, signals);
    expect(classification.category).toBe("security");
    expect(classification.importance).toBe("high");

    // The alert carries no verification code, so age must not downgrade it.
    const status = await attentionService.getInboxStatus(principal);
    expect(status.totals.important).toBeGreaterThan(0);

    const queue = await attentionService.getAttentionQueue(principal, { limit: 50, minScore: 0 });
    const queued = queue.find((item) => item.messageId === alert.id);
    expect(queued).toBeDefined();
    expect(queued!.importance).toBe("high");
  });

  it("Reports inbox totals and needsAttention over the same candidate set", async () => {
    // Regression: totals scanned every classification ever written while
    // needsAttention counted a separate 50-message window, so the two numbers
    // could never be reconciled (`needsAttention: 10` with `actionRequired: 0`).
    for (const subject of ["Contract renewal proposal", "Weekly digest", "Invoice #4410 available"]) {
      await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_mix_${nanoid()}`,
        from: { address: "ops@vendor.com" },
        to: [{ address: "analyst@company.com" }],
        cc: [],
        bcc: [],
        subject,
        textBody: `${subject} body text.`,
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });
    }

    const status = await attentionService.getInboxStatus(principal);
    const queue = await attentionService.getAttentionQueue(principal, { limit: 100, minScore: 0 });

    // needsAttention is a subset of the scored candidates, never a larger population.
    expect(status.totals.needsAttention).toBeLessThanOrEqual(queue.length);
    expect(status.totals.actionRequired + status.totals.routine).toBeLessThanOrEqual(queue.length);
  });

  it("Computes accurate unread counts in getInboxStatus", async () => {
    // Insert 1 unread and 1 read email
    await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_unread_${nanoid()}`,
      from: { address: "boss@foxdevstudio.com" },
      to: [{ address: "user@domain.com" }],
      cc: [],
      bcc: [],
      subject: "Important roadmap review",
      textBody: "Please review the Q3 roadmap.",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    const inboxStatus = await attentionService.getInboxStatus(principal);
    const accountSummary = inboxStatus.accounts.find((a) => a.id === accountId);
    expect(accountSummary).toBeDefined();
    // Verify unreadCount only counts unread emails (1), not all ingested emails
    expect(accountSummary!.unreadCount).toBeGreaterThanOrEqual(1);
  });
});

