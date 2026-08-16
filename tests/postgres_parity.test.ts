import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SendApprovalNotConfirmedError,
  SendApprovalAlreadyUsedError,
  SendApprovalInvalidError,
} from "../src/utils/errors";

describe("Production Distributed Idempotency & Concurrency Parity", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Postgres Parity Org ${id}`,
      slug: `pg-org-${id}`,
      ownerEmail: `parity-${id}@example.com`,
      ownerDisplayName: "Parity User",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
    };

    accountId = nanoid();
    identityId = nanoid();
    const now = new Date();

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Mock Mailbox",
      emailAddress: "parity@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.emailIdentities).values({
      id: identityId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      email: "parity@example.com",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Two independent Worker instances racing to send the same approved draft execute provider.send exactly once", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "customer@corp.com" }],
      subject: "Critical Statement",
      textBody: "Please find your monthly statement attached.",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    const sharedIdempotencyKey = `dist_lock_${nanoid()}`;

    // Simulate Worker Instance 1 and Worker Instance 2 calling sendDraft concurrently
    const [worker1Result, worker2Result] = await Promise.all([
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey: sharedIdempotencyKey,
      }),
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey: sharedIdempotencyKey,
      }),
    ]);

    expect(worker1Result.success).toBe(true);
    expect(worker2Result.success).toBe(true);

    // Both workers receive the exact same provider message ID (no double dispatch)
    expect(worker1Result.providerMessageId).toBe(worker2Result.providerMessageId);

    // Verify in database that exactly 1 send attempt record exists
    const attempts = await db
      .select()
      .from(schema.sendAttempts)
      .where(
        and(
          eq(schema.sendAttempts.tenantId, principal.tenantId),
          eq(schema.sendAttempts.idempotencyKey, sharedIdempotencyKey)
        )
      );

    expect(attempts.length).toBe(1);
    expect(attempts[0]!.status).toBe("sent");
  });

  it("Draft modification between human confirmation and send triggers atomicity failure", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "customer@corp.com" }],
      subject: "Wire Agreement",
      textBody: "Send $1,000 to Account 123",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // Unauthorized edit right after confirmation
    await draftService.editDraft(principal, draft.id, {
      textBody: "Send $1,000,000 to Account 999 (Attacker)",
    });

    // Send attempt must fail with invalid hash error
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalInvalidError);
  });
});
