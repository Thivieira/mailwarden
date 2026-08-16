import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { draftService } from "../../services/drafts";
import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../utils/errors";

const mailAddressSchema = z.object({
  name: z.string().optional(),
  address: z.string().email(),
});

async function resolveSendingIdentity(
  principal: AuthPrincipal,
  params: { identityId?: string; accountId?: string; fromEmail?: string }
) {
  let identities: any[] = [];

  if (params.identityId) {
    identities = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.id, params.identityId),
      eq(schema.emailIdentities.tenantId, principal.tenantId),
      eq(schema.emailIdentities.userId, principal.userId)
    ));
  } else if (params.fromEmail) {
    identities = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.email, params.fromEmail.toLowerCase()),
      eq(schema.emailIdentities.tenantId, principal.tenantId),
      eq(schema.emailIdentities.userId, principal.userId)
    ));
  } else if (params.accountId) {
    identities = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.accountId, params.accountId),
      eq(schema.emailIdentities.tenantId, principal.tenantId),
      eq(schema.emailIdentities.userId, principal.userId)
    ));
  } else {
    identities = await db.select().from(schema.emailIdentities).where(and(
      eq(schema.emailIdentities.tenantId, principal.tenantId),
      eq(schema.emailIdentities.userId, principal.userId)
    ));
  }

  if (identities.length === 1) return identities[0];
  if (identities.length === 0) throw new ValidationError("No sending identity matched this request. Connect an email account first.");

  const options = identities.map((i) => i.email).join(", ");
  throw new ValidationError(`Multiple sending accounts are available (${options}). Specify which address should send the email using fromEmail.`);
}

export const draftTools = [
  {
    name: "draft_reply",
    description: "Creates a draft reply to an existing email message with appropriate thread tracking and sender identity.",
    parameters: z.object({
      replyToMessageId: z.string().describe("The Mailwarden message ID to reply to"),
      textBody: z.string().describe("The text content of the reply"),
      replyAll: z.boolean().optional().default(false).describe("Whether to include the other original recipients"),
      signatureProfileName: z.string().optional().describe("Optional signature name (e.g. consulting, professional, work)"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const { draft, payloadHash } = await draftService.createReplyDraft(principal, params);
      return {
        draftId: draft.id,
        fromAccountId: draft.accountId,
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
    description: "Creates a new standalone email draft. Prefer fromEmail when the user has multiple connected accounts; internal account/identity IDs are optional implementation details.",
    parameters: z.object({
      fromEmail: z.string().email().optional().describe("Human-friendly sending address, e.g. me@gmail.com. Omit if only one sending account exists."),
      accountId: z.string().optional().describe("Optional internal email account ID"),
      identityId: z.string().optional().describe("Optional internal sending identity ID"),
      to: z.array(mailAddressSchema).min(1).describe("Recipient email addresses"),
      cc: z.array(mailAddressSchema).optional().describe("CC recipients"),
      bcc: z.array(mailAddressSchema).optional().describe("BCC recipients"),
      subject: z.string().describe("Email subject"),
      textBody: z.string().describe("Email text body"),
      signatureProfileName: z.string().optional().describe("Signature profile to attach"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const identity = await resolveSendingIdentity(principal, params);
      const { fromEmail: _fromEmail, ...draftParams } = params;
      const { draft, payloadHash } = await draftService.createDraft(principal, {
        ...draftParams,
        accountId: identity.accountId,
        identityId: identity.id,
      });
      return {
        draftId: draft.id,
        from: identity.email,
        accountId: draft.accountId,
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
      originalMessageId: z.string().describe("The original Mailwarden message ID to forward"),
      to: z.array(mailAddressSchema).min(1).describe("Recipients to forward to"),
      introductoryText: z.string().optional().describe("Optional commentary text above forwarded message"),
      signatureProfileName: z.string().optional().describe("Optional signature"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const [orig] = await db.select().from(schema.emails).where(and(
        eq(schema.emails.id, params.originalMessageId),
        eq(schema.emails.tenantId, principal.tenantId),
        eq(schema.emails.userId, principal.userId)
      )).limit(1);
      if (!orig) throw new NotFoundError("Email message", params.originalMessageId);

      const [identity] = await db.select().from(schema.emailIdentities).where(and(
        eq(schema.emailIdentities.accountId, orig.accountId),
        eq(schema.emailIdentities.tenantId, principal.tenantId),
        eq(schema.emailIdentities.userId, principal.userId)
      )).limit(1);
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
      return { draftId: draft.id, from: identity.email, payloadHash, status: draft.status };
    },
  },
  {
    name: "get_draft",
    description: "Retrieves the current draft content, revision number, and computed payload hash.",
    parameters: z.object({ draftId: z.string().describe("The draft ID") }),
    handler: async (principal: AuthPrincipal, params: { draftId: string }) => {
      const { draft, payloadHash } = await draftService.getDraftWithHash(principal, params.draftId);
      const [identity] = await db.select().from(schema.emailIdentities).where(and(
        eq(schema.emailIdentities.id, draft.identityId),
        eq(schema.emailIdentities.tenantId, principal.tenantId)
      )).limit(1);
      return {
        draftId: draft.id,
        from: identity?.email,
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
    description: "Updates an existing draft. Any edit invalidates previous send approvals.",
    parameters: z.object({
      draftId: z.string().describe("The draft ID"),
      to: z.array(mailAddressSchema).optional(),
      cc: z.array(mailAddressSchema).optional(),
      bcc: z.array(mailAddressSchema).optional(),
      subject: z.string().optional(),
      textBody: z.string().optional(),
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
        message: "Draft updated. Any prior approval is invalid; confirm the new version before sending.",
      };
    },
  },
  {
    name: "list_drafts",
    description: "Lists active email drafts created by the user.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => ({ count: (await draftService.listDrafts(principal)).length, drafts: await draftService.listDrafts(principal) }),
  },
  {
    name: "set_draft_signature",
    description: "Applies a predefined user signature profile (e.g. consulting, professional, work) to a draft.",
    parameters: z.object({
      draftId: z.string(),
      signatureProfileName: z.string(),
    }),
    handler: async (principal: AuthPrincipal, params: { draftId: string; signatureProfileName: string }) => {
      const { draft, payloadHash } = await draftService.setDraftSignature(principal, params.draftId, params.signatureProfileName);
      return { draftId: draft.id, signatureApplied: params.signatureProfileName, textBody: draft.textBody, payloadHash };
    },
  },
];
