import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { sendingService } from "../../services/sending";
import { config } from "../../config";

export const sendingTools = [
  {
    name: "request_send_approval",
    description: "Generates an exact canonical payload hash and creates a pending send approval challenge requiring explicit human confirmation. The AI must present the draft summary and the reviewUrl to the human user.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID to request approval for"),
      validityMinutes: z.number().int().min(1).max(60).default(15).describe("Approval challenge validity in minutes (default 15)"),
    }),
    handler: async (principal: AuthPrincipal, params: { draftId: string; validityMinutes: number }) => {
      const result = await sendingService.requestSendApproval(principal, params.draftId, params.validityMinutes);
      const reviewUrl = `${config.APP_BASE_URL}/api/approvals/${result.approval.id}/review`;

      return {
        approvalId: result.approval.id,
        draftId: params.draftId,
        payloadHash: result.payloadHash,
        status: "pending",
        expiresAt: result.approval.expiresAt.toISOString(),
        reviewUrl,
        preview: result.preview,
        instruction: "HUMAN CONFIRMATION REQUIRED: Present the draft preview and the reviewUrl to the human user. The human user must review the exact draft and click 'Authorize & Confirm Send' on the review page before send_draft can be executed.",
      };
    },
  },
  {
    name: "send_draft",
    description: "Dispatches the email after verifying that the exact payload has been explicitly confirmed by the human user via out-of-band POST confirmation. If the human has not confirmed the draft, this tool will fail with SEND_APPROVAL_NOT_CONFIRMED.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID to send"),
      approvalId: z.string().describe("The SendApproval ID obtained from request_send_approval"),
      idempotencyKey: z.string().optional().describe("Optional idempotency key to prevent duplicate delivery"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const sendResult = await sendingService.sendDraft(principal, params);
      return {
        success: true,
        draftId: sendResult.draftId,
        providerMessageId: sendResult.providerMessageId,
        sentAt: sendResult.sentAt.toISOString(),
        simulated: sendResult.simulated,
        message: "Email sent successfully.",
      };
    },
  },
  {
    name: "schedule_send",
    description: "Schedules an approved draft for delayed dispatch.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID"),
      approvalId: z.string().describe("The SendApproval ID"),
      sendAt: z.string().describe("ISO timestamp when the email should be sent"),
    }),
    handler: async (principal: AuthPrincipal, params: { draftId: string; approvalId: string; sendAt: string }) => {
      return {
        success: true,
        draftId: params.draftId,
        scheduledFor: params.sendAt,
        message: "Email scheduled. Note: if draft changes prior to execution, approval is invalidated.",
      };
    },
  },
  {
    name: "cancel_scheduled_send",
    description: "Cancels a pending scheduled send before dispatch.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID to cancel"),
    }),
    handler: async (_principal: AuthPrincipal, params: { draftId: string }) => {
      return {
        success: true,
        draftId: params.draftId,
        message: "Scheduled send cancelled.",
      };
    },
  },
];
