import { db, schema } from "../db";
import { eq, and, desc } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type { MailAddress, DraftAttachment } from "../types/domain";
import type { StoredDraft, SignatureProfile } from "../types/drafts";
import { authService } from "./auth";
import { auditService } from "./audit";
import { computeSendPayloadHash, type CanonicalSendPayload } from "../utils/hash";
import { NotFoundError, AuthorizationError, ValidationError } from "../utils/errors";
import { nanoid } from "nanoid";

export class DraftService {
  /**
   * Creates a new standalone draft email
   */
  async createDraft(
    principal: AuthPrincipal,
    params: {
      accountId: string;
      identityId: string;
      to: MailAddress[];
      cc?: MailAddress[];
      bcc?: MailAddress[];
      subject: string;
      textBody: string;
      htmlBody?: string;
      signatureProfileName?: string;
      attachments?: DraftAttachment[];
      replyToMessageId?: string;
      threadId?: string;
    }
  ): Promise<{ draft: StoredDraft; payloadHash: string }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    // Verify identity ownership
    const [identity] = await db
      .select()
      .from(schema.emailIdentities)
      .where(
        and(
          eq(schema.emailIdentities.id, params.identityId),
          eq(schema.emailIdentities.tenantId, principal.tenantId),
          eq(schema.emailIdentities.userId, principal.userId)
        )
      )
      .limit(1);

    if (!identity) {
      throw new ValidationError(`Sending identity '${params.identityId}' not found or unauthorized`);
    }

    // Resolve signature if requested or default
    let signatureProfile: typeof schema.signatureProfiles.$inferSelect | undefined = undefined;
    if (params.signatureProfileName) {
      const [sig] = await db
        .select()
        .from(schema.signatureProfiles)
        .where(
          and(
            eq(schema.signatureProfiles.tenantId, principal.tenantId),
            eq(schema.signatureProfiles.userId, principal.userId),
            eq(schema.signatureProfiles.name, params.signatureProfileName)
          )
        )
        .limit(1);
      signatureProfile = sig;
    }

    const draftId = nanoid();
    const now = new Date();

    const renderedSignature = signatureProfile ? signatureProfile.plainText : undefined;
    const fullTextBody = renderedSignature
      ? `${params.textBody.trim()}\n\n${renderedSignature}`
      : params.textBody.trim();

    await db.insert(schema.drafts).values({
      id: draftId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId: params.accountId,
      identityId: params.identityId,
      replyToMessageId: params.replyToMessageId || null,
      threadId: params.threadId || null,
      toAddresses: params.to,
      ccAddresses: params.cc || [],
      bccAddresses: params.bcc || [],
      subject: params.subject.trim(),
      textBody: fullTextBody,
      htmlBody: params.htmlBody || null,
      signatureProfileId: signatureProfile?.id || null,
      renderedSignature: renderedSignature || null,
      attachments: params.attachments || [],
      status: "draft",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Record revision 1
    await db.insert(schema.draftRevisions).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      draftId,
      revisionNumber: 1,
      snapshot: {
        to: params.to,
        subject: params.subject,
        textBody: fullTextBody,
      },
      createdAt: now,
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "DRAFT_CREATE",
      resourceType: "draft",
      resourceId: draftId,
      details: { to: params.to.map((t) => t.address), subject: params.subject },
    });

    return this.getDraftWithHash(principal, draftId);
  }

  /**
   * Creates a reply draft in response to an existing message or thread
   */
  async createReplyDraft(
    principal: AuthPrincipal,
    params: {
      replyToMessageId: string;
      textBody: string;
      replyAll?: boolean;
      signatureProfileName?: string;
    }
  ): Promise<{ draft: StoredDraft; payloadHash: string }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    // Fetch original message
    const [orig] = await db
      .select()
      .from(schema.emails)
      .where(
        and(
          eq(schema.emails.id, params.replyToMessageId),
          eq(schema.emails.tenantId, principal.tenantId),
          eq(schema.emails.userId, principal.userId)
        )
      )
      .limit(1);

    if (!orig) {
      throw new NotFoundError("Original email message", params.replyToMessageId);
    }

    // Find sending identity for this account
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

    if (!identity) {
      throw new ValidationError(`No valid sending identity found for account ${orig.accountId}`);
    }

    // Determine recipients
    const to: MailAddress[] = [{ name: orig.fromName || undefined, address: orig.fromAddress }];
    const cc: MailAddress[] = [];

    if (params.replyAll) {
      // Add all original recipients except self
      const myEmail = identity.email.toLowerCase();
      const allTo = (orig.toAddresses || []).filter((a: any) => a.address.toLowerCase() !== myEmail);
      const allCc = (orig.ccAddresses || []).filter((a: any) => a.address.toLowerCase() !== myEmail);
      to.push(...allTo);
      cc.push(...allCc);
    }

    const replySubject = orig.subject.startsWith("Re:") ? orig.subject : `Re: ${orig.subject}`;

    return this.createDraft(principal, {
      accountId: orig.accountId,
      identityId: identity.id,
      to,
      cc,
      subject: replySubject,
      textBody: params.textBody,
      replyToMessageId: orig.providerMessageId,
      threadId: orig.providerThreadId || undefined,
      signatureProfileName: params.signatureProfileName,
    });
  }

  /**
   * Edits an existing draft (changes recipients, subject, body, etc.)
   */
  async editDraft(
    principal: AuthPrincipal,
    draftId: string,
    updates: {
      to?: MailAddress[];
      cc?: MailAddress[];
      bcc?: MailAddress[];
      subject?: string;
      textBody?: string;
      htmlBody?: string;
    }
  ): Promise<{ draft: StoredDraft; payloadHash: string }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    const [existing] = await db
      .select()
      .from(schema.drafts)
      .where(
        and(
          eq(schema.drafts.id, draftId),
          eq(schema.drafts.tenantId, principal.tenantId),
          eq(schema.drafts.userId, principal.userId)
        )
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Draft", draftId);
    }

    if (existing.status === "sent") {
      throw new ValidationError("Cannot edit a draft that has already been sent");
    }

    const now = new Date();
    const newRevision = existing.revision + 1;

    const toAddresses = updates.to || existing.toAddresses;
    const ccAddresses = updates.cc !== undefined ? updates.cc : existing.ccAddresses;
    const bccAddresses = updates.bcc !== undefined ? updates.bcc : existing.bccAddresses;
    const subject = updates.subject !== undefined ? updates.subject : existing.subject;
    const textBody = updates.textBody !== undefined ? updates.textBody : existing.textBody;
    const htmlBody = updates.htmlBody !== undefined ? updates.htmlBody : existing.htmlBody;

    await db
      .update(schema.drafts)
      .set({
        toAddresses,
        ccAddresses,
        bccAddresses,
        subject,
        textBody,
        htmlBody,
        revision: newRevision,
        status: "draft", // Reset to draft status if it had a pending approval
        updatedAt: now,
      })
      .where(eq(schema.drafts.id, draftId));

    // Record revision
    await db.insert(schema.draftRevisions).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      draftId,
      revisionNumber: newRevision,
      snapshot: { to: toAddresses, subject, textBody },
      createdAt: now,
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "DRAFT_UPDATE",
      resourceType: "draft",
      resourceId: draftId,
      details: { revision: newRevision },
    });

    return this.getDraftWithHash(principal, draftId);
  }

  /**
   * Applies a specific signature profile to a draft
   */
  async setDraftSignature(
    principal: AuthPrincipal,
    draftId: string,
    signatureName: string
  ): Promise<{ draft: StoredDraft; payloadHash: string }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    const [sig] = await db
      .select()
      .from(schema.signatureProfiles)
      .where(
        and(
          eq(schema.signatureProfiles.tenantId, principal.tenantId),
          eq(schema.signatureProfiles.userId, principal.userId),
          eq(schema.signatureProfiles.name, signatureName)
        )
      )
      .limit(1);

    if (!sig) {
      throw new NotFoundError("Signature profile", signatureName);
    }

    const { draft } = await this.getDraftWithHash(principal, draftId);

    // Strip previous signature if present
    let body = draft.textBody;
    if (draft.renderedSignature && body.includes(draft.renderedSignature)) {
      body = body.replace(draft.renderedSignature, "").trim();
    }

    const newBody = `${body}\n\n${sig.plainText}`;

    await db
      .update(schema.drafts)
      .set({
        textBody: newBody,
        signatureProfileId: sig.id,
        renderedSignature: sig.plainText,
        updatedAt: new Date(),
      })
      .where(eq(schema.drafts.id, draftId));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "DRAFT_SIGNATURE_SET",
      resourceType: "draft",
      resourceId: draftId,
      details: { signatureName },
    });

    return this.getDraftWithHash(principal, draftId);
  }

  /**
   * Retrieves a draft and computes its current SHA-256 canonical payload hash
   */
  async getDraftWithHash(
    principal: AuthPrincipal,
    draftId: string
  ): Promise<{ draft: StoredDraft; payloadHash: string }> {
    authService.requirePrincipal(principal);

    const [row] = await db
      .select()
      .from(schema.drafts)
      .where(
        and(
          eq(schema.drafts.id, draftId),
          eq(schema.drafts.tenantId, principal.tenantId),
          eq(schema.drafts.userId, principal.userId)
        )
      )
      .limit(1);

    if (!row) {
      throw new NotFoundError("Draft", draftId);
    }

    const draft: StoredDraft = {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      accountId: row.accountId,
      identityId: row.identityId,
      replyToMessageId: row.replyToMessageId || undefined,
      threadId: row.threadId || undefined,
      to: row.toAddresses,
      cc: row.ccAddresses || [],
      bcc: row.bccAddresses || [],
      subject: row.subject,
      textBody: row.textBody,
      htmlBody: row.htmlBody || undefined,
      signatureProfileId: row.signatureProfileId || undefined,
      renderedSignature: row.renderedSignature || undefined,
      attachments: row.attachments || [],
      status: row.status as any,
      providerDraftId: row.providerDraftId || undefined,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    const canonicalPayload: CanonicalSendPayload = {
      tenantId: draft.tenantId,
      userId: draft.userId,
      accountId: draft.accountId,
      identityId: draft.identityId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      textBody: draft.textBody,
      htmlBody: draft.htmlBody,
      signatureProfileId: draft.signatureProfileId,
      renderedSignature: draft.renderedSignature,
      replyToMessageId: draft.replyToMessageId,
      attachments: draft.attachments.map((att) => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        contentHash: att.contentHash,
      })),
    };

    const payloadHash = computeSendPayloadHash(canonicalPayload);

    return { draft, payloadHash };
  }

  /**
   * Lists all active drafts for the authenticated user
   */
  async listDrafts(principal: AuthPrincipal): Promise<StoredDraft[]> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.draft");

    const rows = await db
      .select()
      .from(schema.drafts)
      .where(
        and(
          eq(schema.drafts.tenantId, principal.tenantId),
          eq(schema.drafts.userId, principal.userId)
        )
      )
      .orderBy(desc(schema.drafts.updatedAt));

    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      accountId: r.accountId,
      identityId: r.identityId,
      replyToMessageId: r.replyToMessageId || undefined,
      threadId: r.threadId || undefined,
      to: r.toAddresses,
      cc: r.ccAddresses || [],
      bcc: r.bccAddresses || [],
      subject: r.subject,
      textBody: r.textBody,
      htmlBody: r.htmlBody || undefined,
      signatureProfileId: r.signatureProfileId || undefined,
      renderedSignature: r.renderedSignature || undefined,
      attachments: r.attachments || [],
      status: r.status as any,
      providerDraftId: r.providerDraftId || undefined,
      revision: r.revision,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}

export const draftService = new DraftService();
