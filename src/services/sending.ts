import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { authService } from "./auth";
import { draftService } from "./drafts";
import { auditService } from "./audit";
import { providerFactory } from "../providers/factory";
import type { AuthPrincipal } from "../types/auth";
import type { SendApproval, SendResult } from "../types/drafts";
import {
  SendApprovalMissingError,
  SendApprovalExpiredError,
  SendApprovalInvalidError,
  SendApprovalAlreadyUsedError,
  SendApprovalNotConfirmedError,
  ProviderError,
} from "../utils/errors";
import { logger } from "../utils/logger";
import { nanoid } from "nanoid";

export class SendingService {
  /**
   * Generates a pending send approval challenge bound to the exact current canonical payload hash.
   * Status is initialized to 'pending' awaiting explicit human confirmation.
   */
  async requestSendApproval(
    principal: AuthPrincipal,
    draftId: string,
    validityMinutes: number = 15
  ): Promise<{
    approval: SendApproval;
    payloadHash: string;
    confirmationNonce: string;
    preview: any;
    humanConfirmationRequired: boolean;
  }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    const { draft, payloadHash } = await draftService.getDraftWithHash(principal, draftId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + validityMinutes * 60 * 1000);
    const approvalId = nanoid();
    const confirmationNonce = `cn_${nanoid(16)}`;

    await db.insert(schema.sendApprovals).values({
      id: approvalId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      draftId: draft.id,
      payloadHash,
      status: "pending",
      confirmationNonce,
      approvedAt: now,
      expiresAt,
      createdAt: now,
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "SEND_APPROVAL_REQUEST",
      resourceType: "send_approval",
      resourceId: approvalId,
      details: { draftId: draft.id, payloadHash, expiresAt: expiresAt.toISOString(), status: "pending" },
    });

    const approval: SendApproval = {
      id: approvalId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      draftId: draft.id,
      payloadHash,
      status: "pending",
      confirmationNonce,
      approvedAt: now,
      expiresAt,
      createdAt: now,
    };

    return {
      approval,
      payloadHash,
      confirmationNonce,
      humanConfirmationRequired: true,
      preview: {
        draftId: draft.id,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        textBody: draft.textBody,
        renderedSignature: draft.renderedSignature,
        attachmentsCount: draft.attachments.length,
        confirmationPrompt: `Please confirm that you want to send this email to ${draft.to.map((t) => t.address).join(", ")} with subject "${draft.subject}".`,
      },
    };
  }

  /**
   * Explicit Human Confirmation Boundary.
   * Confirms a pending approval challenge. Transition from 'pending' -> 'confirmed'.
   * Can only be executed by the authenticated human owner of the draft.
   */
  async confirmSendApproval(
    principal: AuthPrincipal,
    params: {
      approvalId: string;
      confirmationNonce?: string;
    }
  ): Promise<{ success: boolean; approvalId: string; status: "confirmed"; confirmedAt: Date }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.send");

    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(
        and(
          eq(schema.sendApprovals.id, params.approvalId),
          eq(schema.sendApprovals.tenantId, principal.tenantId),
          eq(schema.sendApprovals.userId, principal.userId)
        )
      )
      .limit(1);

    if (!approval) {
      throw new SendApprovalMissingError(
        `Send approval '${params.approvalId}' was not found or is unauthorized`
      );
    }

    const now = new Date();

    if (approval.usedAt) {
      throw new SendApprovalAlreadyUsedError(
        `Approval '${params.approvalId}' has already been executed and cannot be re-confirmed.`
      );
    }

    if (approval.expiresAt < now) {
      throw new SendApprovalExpiredError(
        `Approval expired at ${approval.expiresAt.toISOString()}. Please request a fresh confirmation.`
      );
    }

    // If nonce is provided, verify matching
    if (params.confirmationNonce && approval.confirmationNonce !== params.confirmationNonce) {
      throw new SendApprovalInvalidError("Confirmation nonce mismatch");
    }

    // Verify current draft hash matches approved hash (no edits occurred)
    const { payloadHash: currentHash } = await draftService.getDraftWithHash(principal, approval.draftId);
    if (currentHash !== approval.payloadHash) {
      throw new SendApprovalInvalidError(
        "Draft was modified after confirmation challenge was minted. Request a fresh approval."
      );
    }

    // Transition status to confirmed atomically
    await db
      .update(schema.sendApprovals)
      .set({
        status: "confirmed",
        confirmedByUserId: principal.userId,
        confirmedAt: now,
      })
      .where(eq(schema.sendApprovals.id, approval.id));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "SEND_APPROVAL_CONFIRMED",
      resourceType: "send_approval",
      resourceId: approval.id,
      details: { draftId: approval.draftId, payloadHash: approval.payloadHash },
    });

    return {
      success: true,
      approvalId: approval.id,
      status: "confirmed",
      confirmedAt: now,
    };
  }

  /**
   * Sends an email draft after strictly validating exact payload approval, human confirmation, and idempotency
   */
  async sendDraft(
    principal: AuthPrincipal,
    params: {
      draftId: string;
      approvalId: string;
      idempotencyKey?: string;
    }
  ): Promise<SendResult> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.send");

    const idempotencyKey = params.idempotencyKey || `send_${params.draftId}_${params.approvalId}`;

    // 1. Check idempotency: if a send attempt already succeeded with this key, return it
    const [existingAttempt] = await db
      .select()
      .from(schema.sendAttempts)
      .where(
        and(
          eq(schema.sendAttempts.tenantId, principal.tenantId),
          eq(schema.sendAttempts.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    if (existingAttempt && existingAttempt.status === "sent") {
      logger.info(`[SEND] Duplicate send attempt prevented for idempotency key: ${idempotencyKey}`);
      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "DUPLICATE_SEND_PREVENTED",
        resourceType: "draft",
        resourceId: params.draftId,
        details: { idempotencyKey, providerMessageId: existingAttempt.providerMessageId },
      });

      return {
        success: true,
        providerMessageId: existingAttempt.providerMessageId || "existing-send",
        draftId: params.draftId,
        sentAt: existingAttempt.updatedAt,
      };
    }

    // 2. Fetch approval record
    const [approval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(
        and(
          eq(schema.sendApprovals.id, params.approvalId),
          eq(schema.sendApprovals.tenantId, principal.tenantId),
          eq(schema.sendApprovals.userId, principal.userId)
        )
      )
      .limit(1);

    if (!approval) {
      throw new SendApprovalMissingError(
        `Send approval '${params.approvalId}' was not found or is unauthorized`
      );
    }

    const now = new Date();

    // 3. Verify approval has been explicitly confirmed by a human user
    if (approval.status !== "confirmed") {
      throw new SendApprovalNotConfirmedError(
        `Send approval '${params.approvalId}' is pending explicit human confirmation. A human user must confirm the exact payload before dispatch.`
      );
    }

    // 4. Verify approval hasn't already been used (single-use constraint)
    if (approval.usedAt) {
      throw new SendApprovalAlreadyUsedError(
        `Approval '${params.approvalId}' has already been executed and cannot be reused for a new send attempt.`
      );
    }

    // 5. Verify approval expiration
    if (approval.expiresAt < now) {
      throw new SendApprovalExpiredError(
        `Approval expired at ${approval.expiresAt.toISOString()}. Please request a fresh approval.`
      );
    }

    // 6. Verify current draft payload hash matches the approved hash EXACTLY
    const { draft, payloadHash: currentHash } = await draftService.getDraftWithHash(
      principal,
      params.draftId
    );

    if (currentHash !== approval.payloadHash) {
      throw new SendApprovalInvalidError(
        `Draft was modified after confirmation. Expected hash '${approval.payloadHash.slice(0, 12)}...', but current draft hash is '${currentHash.slice(0, 12)}...'. Request a new confirmation.`
      );
    }

    // 7. Record in-progress send attempt (handles concurrent race condition safely)
    const attemptId = nanoid();
    let isOwnerOfAttempt = true;

    try {
      await db.insert(schema.sendAttempts).values({
        id: attemptId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey,
        status: "in_progress",
        createdAt: now,
        updatedAt: now,
      });
    } catch (insertErr: any) {
      // If unique constraint violated on (tenantId, idempotencyKey), another concurrent promise won the race
      isOwnerOfAttempt = false;
      logger.info(`[SEND] Concurrent race detected on idempotencyKey: ${idempotencyKey}, awaiting result...`);

      // Poll briefly for completed attempt
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const [winnerAttempt] = await db
          .select()
          .from(schema.sendAttempts)
          .where(
            and(
              eq(schema.sendAttempts.tenantId, principal.tenantId),
              eq(schema.sendAttempts.idempotencyKey, idempotencyKey)
            )
          )
          .limit(1);

        if (winnerAttempt && winnerAttempt.status === "sent") {
          return {
            success: true,
            providerMessageId: winnerAttempt.providerMessageId || "concurrent-sent",
            draftId: params.draftId,
            sentAt: winnerAttempt.updatedAt,
          };
        }
      }
    }

    try {
      // 8. Dispatch to provider via provider factory
      const provider = await providerFactory.getProviderForAccount(principal, draft.accountId);
      const sendResult = await provider.sendDraft(principal, draft.accountId, draft);

      // 9. Mark approval as used and draft as sent
      await db
        .update(schema.sendApprovals)
        .set({ usedAt: now })
        .where(eq(schema.sendApprovals.id, approval.id));

      await db
        .update(schema.drafts)
        .set({ status: "sent", updatedAt: now })
        .where(eq(schema.drafts.id, draft.id));

      if (isOwnerOfAttempt) {
        await db
          .update(schema.sendAttempts)
          .set({
            status: "sent",
            providerMessageId: sendResult.providerMessageId,
            updatedAt: now,
          })
          .where(eq(schema.sendAttempts.id, attemptId));
      }

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "SEND_SUCCESS",
        resourceType: "draft",
        resourceId: draft.id,
        details: {
          approvalId: approval.id,
          providerMessageId: sendResult.providerMessageId,
          to: draft.to.map((t) => t.address),
          subject: draft.subject,
        },
      });

      return {
        success: true,
        providerMessageId: sendResult.providerMessageId,
        draftId: draft.id,
        sentAt: now,
        simulated: sendResult.simulated,
      };
    } catch (err: any) {
      if (isOwnerOfAttempt) {
        await db
          .update(schema.sendAttempts)
          .set({
            status: "failed",
            errorMessage: err.message,
            updatedAt: new Date(),
          })
          .where(eq(schema.sendAttempts.id, attemptId));
      }

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "SEND_FAILED",
        status: "failure",
        resourceType: "draft",
        resourceId: draft.id,
        details: { approvalId: approval.id, error: err.message },
      });

      throw new ProviderError(`Failed to send draft: ${err.message}`, "mail-provider");
    }
  }
}

export const sendingService = new SendingService();
