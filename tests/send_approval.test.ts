import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import {
  SendApprovalMissingError,
  SendApprovalInvalidError,
  SendApprovalExpiredError,
  SendApprovalAlreadyUsedError,
  SendApprovalNotConfirmedError,
} from "../src/utils/errors";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Exact Payload Send Confirmation & Idempotency", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Send Test Org ${id}`,
      slug: `send-org-${id}`,
      ownerEmail: `sender-${id}@example.com`,
      ownerDisplayName: "Sender User",
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
      emailAddress: "sender@example.com",
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
      email: "sender@example.com",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Sending without explicit approval fails", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "recipient@example.com" }],
      subject: "Test Proposal",
      textBody: "Initial draft",
    });

    // Attempting send without valid approval
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: "non_existent_approval",
      })
    ).rejects.toThrow(SendApprovalMissingError);
  });

  it("Sending a pending approval before human confirmation is strictly rejected", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "recipient@example.com" }],
      subject: "Test Proposal",
      textBody: "Initial draft",
    });

    const { approval } = await sendingService.requestSendApproval(principal, draft.id);

    // AI attempts to send immediately without human confirmation
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalNotConfirmedError);
  });

  it("Sending with valid human-confirmed approval succeeds", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "recipient@example.com" }],
      subject: "Test Proposal",
      textBody: "Please find the proposal attached.",
    });

    const { approval, payloadHash, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    expect(approval.payloadHash).toBe(payloadHash);

    // Human confirms the approval challenge
    const confirmResult = await sendingService.confirmSendApproval(principal, {
      approvalId: approval.id,
      confirmationNonce,
    });
    expect(confirmResult.status).toBe("confirmed");

    const result = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
    });

    expect(result.success).toBe(true);
    expect(result.draftId).toBe(draft.id);
    expect(result.providerMessageId).toBeDefined();

    // Verify draft status is updated to sent
    const { draft: updatedDraft } = await draftService.getDraftWithHash(principal, draft.id);
    expect(updatedDraft.status).toBe("sent");
  });

  it("Modifying recipient after approval invalidates the approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "original@example.com" }],
      subject: "Important contract",
      textBody: "Confidential terms",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // AI or attacker modifies recipient
    await draftService.editDraft(principal, draft.id, {
      to: [{ address: "attacker@evil.com" }],
    });

    // Attempting to send using previous approval must fail with hash mismatch
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalInvalidError);
  });

  it("Modifying body text after approval invalidates the approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Invoice",
      textBody: "Amount due is $500",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // Edit body
    await draftService.editDraft(principal, draft.id, {
      textBody: "Amount due is $50,000 (modified)",
    });

    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalInvalidError);
  });

  it("Changing signature profile after approval invalidates the approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Consulting Inquiry",
      textBody: "Let's schedule a session.",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // Apply consulting signature
    await draftService.setDraftSignature(principal, draft.id, "consulting");

    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalInvalidError);
  });

  it("Expired approval fails to send", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Offer",
      textBody: "Offer details",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // Force approval expiration in database
    await db
      .update(schema.sendApprovals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sendApprovals.id, approval.id));

    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalExpiredError);
  });

  it("Used approval cannot be reused (one-time use constraint)", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Single send",
      textBody: "One time delivery",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // First send succeeds
    const firstSend = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
    });
    expect(firstSend.success).toBe(true);

    // Attempting to send again with same approval fails
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey: "new_custom_key",
      })
    ).rejects.toThrow(SendApprovalAlreadyUsedError);
  });

  it("Idempotent retry with same idempotency key returns existing result without re-dispatching", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Idempotent Send",
      textBody: "Network retry test",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });
    const key = `client_retry_${nanoid()}`;

    // First call
    const firstResult = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
      idempotencyKey: key,
    });

    // Second call with same idempotency key (simulating network timeout retry)
    const secondResult = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
      idempotencyKey: key,
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.providerMessageId).toBe(firstResult.providerMessageId);
  });

  it("GET review requests and automated link prefetchers NEVER mutate approval state", async () => {
    const { app } = await import("../src/http/app");

    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@example.com" }],
      subject: "Prefetch Test",
      textBody: "Testing safe GET semantics.",
    });

    const { approval } = await sendingService.requestSendApproval(principal, draft.id);

    // 1. Simulate automated link scanner / browser prefetch issuing GET requests
    for (let i = 0; i < 3; i++) {
      const getResp = await app.handle(
        new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
          method: "GET",
          headers: { Accept: "text/html" },
        })
      );
      expect(getResp.status).toBe(200);
      const html = await getResp.text();
      expect(html).toContain("Review Outgoing Email");
      expect(html).toContain(approval.payloadHash);
    }

    // Verify approval state in DB remains strictly "pending"
    const [dbApproval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approval.id))
      .limit(1);

    expect(dbApproval.status).toBe("pending");
    expect(dbApproval.confirmedAt).toBeNull();

    // 2. AI calling send_draft still fails because status is still pending
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(SendApprovalNotConfirmedError);

    // 3. Authenticated human POST confirms the pending approval
    const postResp = await app.handle(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );

    expect(postResp.status).toBe(200);
    const postData: any = await postResp.json();
    expect(postData.status).toBe("confirmed");

    // 4. Now send_draft succeeds
    const sendResult = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
    });
    expect(sendResult.success).toBe(true);
  });
});
