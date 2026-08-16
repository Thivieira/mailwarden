import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { draftService } from "../../services/drafts";
import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { authService } from "../../services/auth";
import { NotFoundError } from "../../utils/errors";

const mailAddressSchema = z.object({
  name: z.string().optional(),
  address: z.string().email(),
});

export const draftTools = [
  {
    name: "draft_reply",
    description: "Creates a draft reply to an existing email message with appropriate thread tracking and sender identity.",
    parameters: z.object({
      replyToMessageId: z.string().describe("The message ID to reply to"),
      textBody: z.string().describe("The text content of the reply"),
      replyAll: z.boolean().optional().default(false).describe("Whether to CC all original recipients"),
      signatureProfileName: z.string().optional().describe("Optional signature name (e.g. consulting, professional, work)"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const { draft, payloadHash } = await draftService.createReplyDraft(principal, params);
      return {
        draftId: draft.id,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        textBody: draft.textBody,
        renderedSignature: draft.renderedSignature,
        revision: draft.revision,
        payloadHash,
        status: draft.status,
      };
    },
  },
  {
    name: "draft_email",
    description: "Creates a new standalone email draft for an account and identity.",
    parameters: z.object({
      accountId: z.string().describe("Email account ID"),
      identityId: z.string().describe("Sending identity ID"),
      to: z.array(mailAddressSchema).min(1).describe("List of recipient email addresses"),
      cc: z.array(mailAddressSchema).optional().describe("CC recipients"),
      bcc: z.array(mailAddressSchema).optional().describe("BCC recipients"),
      subject: z.string().describe("Email subject"),
      textBody: z.string().describe("Email text body"),
      signatureProfileName: z.string().optional().describe("Signature profile to attach"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const { draft, payloadHash } = await draftService.createDraft(principal, params);
      return {
        draftId: draft.id,
        to: draft.to,
        subject: draft.subject,
        textBody: draft.textBody,
        payloadHash,
        status: draft.status,
      };
    },
  },
  {
    name: "draft_forward",
    description: "Creates a draft to forward an existing email to new recipients.",
    parameters: z.object({
      originalMessageId: z.string().describe("The original message ID to forward"),
      to: z.array(mailAddressSchema).min(1).describe("Recipients to forward to"),
      introductoryText: z.string().optional().describe("Optional commentary text above forwarded message"),
      signatureProfileName: z.string().optional().describe("Optional signature"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const [orig] = await db
        .select()
        .from(schema.emails)
        .where(
          and(
            eq(schema.emails.id, params.originalMessageId),
            eq(schema.emails.tenantId, principal.tenantId),
            eq(schema.emails.userId, principal.userId)
          )
        )
        .limit(1);

      if (!orig) throw new NotFoundError("Email message", params.originalMessageId);

      const [identity] = await db
        .select()
        .from(schema.emailIdentities)
        .where(
          and(
            eq(schema.emailIdentities.accountId, orig.accountId),
            eq(schema.emailIdentities.tenantId, principal.tenantId),
            eq(schema.emailIdentities.userId, principal.userId)
          )
        )
        .limit(1);

      if (!identity) throw new NotFoundError("Sending identity for account", orig.accountId);

      const forwardBody = `${params.introductoryText ? `${params.introductoryText}\n\n` : ""}---------- Forwarded message ---------\nFrom: ${orig.fromAddress}\nSubject: ${orig.subject}\nDate: ${orig.receivedAt.toISOString()}\n\n${orig.textBody}`;

      const { draft, payloadHash } = await draftService.createDraft(principal, {
        accountId: orig.accountId,
        identityId: identity.id,
        to: params.to,
        subject: `Fwd: ${orig.subject}`,
        textBody: forwardBody,
        signatureProfileName: params.signatureProfileName,
      });

      return { draftId: draft.id, payloadHash, status: draft.status };
    },
  },
  {
    name: "get_draft",
    description: "Retrieves the current draft content, revision number, and computed payload hash.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID"),
    }),
    handler: async (principal: AuthPrincipal, params: { draftId: string }) => {
      const { draft, payloadHash } = await draftService.getDraftWithHash(principal, params.draftId);
      return {
        draftId: draft.id,
        accountId: draft.accountId,
        identityId: draft.identityId,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        textBody: draft.textBody,
        renderedSignature: draft.renderedSignature,
        status: draft.status,
        revision: draft.revision,
        payloadHash,
        updatedAt: draft.updatedAt.toISOString(),
      };
    },
  },
  {
    name: "edit_draft",
    description: "Updates an existing draft (recipient, subject, or text content). Note: any edit invalidates previous send approvals.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID"),
      to: z.array(mailAddressSchema).optional().describe("New recipient list"),
      cc: z.array(mailAddressSchema).optional().describe("New CC list"),
      subject: z.string().optional().describe("New subject line"),
      textBody: z.string().optional().describe("New body text"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const { draftId, ...updates } = params;
      const { draft, payloadHash } = await draftService.editDraft(principal, draftId, updates);
      return {
        draftId: draft.id,
        to: draft.to,
        subject: draft.subject,
        textBody: draft.textBody,
        revision: draft.revision,
        payloadHash,
        message: "Draft updated. Prior send approval has been invalidated; new confirmation required before sending.",
      };
    },
  },
  {
    name: "list_drafts",
    description: "Lists active email drafts created by the user.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      const drafts = await draftService.listDrafts(principal);
      return { count: drafts.length, drafts };
    },
  },
  {
    name: "set_draft_signature",
    description: "Applies a predefined user signature profile (e.g. consulting, professional, work) to a draft.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID"),
      signatureProfileName: z.string().describe("The signature profile name"),
    }),
    handler: async (principal: AuthPrincipal, params: { draftId: string; signatureProfileName: string }) => {
      const { draft, payloadHash } = await draftService.setDraftSignature(
        principal,
        params.draftId,
        params.signatureProfileName
      );
      return {
        draftId: draft.id,
        signatureApplied: params.signatureProfileName,
        textBody: draft.textBody,
        payloadHash,
      };
    },
  },
];
