import { db, schema } from "../db";
import { eq, and, desc, like, or, inArray, gte, lte, sql } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type {
  NormalizedEmail,
  NormalizedAttachment,
  MailboxActionType,
  EmailFlags,
} from "../types/domain";
import type { ThreadState, OpenLoop } from "../types/intelligence";
import { authService } from "./auth";
import { auditService } from "./audit";
import { relationshipService } from "./relationships";
import { intelligenceService } from "./intelligence";
import { policyService } from "./policy";
import { sanitizeEmailContent } from "../utils/sanitizer";
import { NotFoundError, TenantIsolationError } from "../utils/errors";
import { config } from "../config";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger";
import { organizationService } from "./organizations";
import { triageEventService } from "./triage-events";

export interface MailSearchParams {
  query?: string;
  accountId?: string;
  senderEmail?: string;
  organizationId?: string;
  projectId?: string;
  unreadOnly?: boolean;
  actionRequiredOnly?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class EmailService {
  /**
   * Ingests a normalized email, sanitizes content, updates sender profile,
   * updates thread intelligence, extracts signals, and applies configured mail policies.
   */
  async ingestEmail(
    principal: AuthPrincipal,
    input: Omit<NormalizedEmail, "id" | "tenantId" | "userId" | "createdAt" | "updatedAt">
  ): Promise<NormalizedEmail> {
    authService.requirePrincipal(principal);
    await organizationService.requireWorkspaceMembership(principal, principal.tenantId);

    // Sanitize untrusted content (strip tracking pixels, script injection, extract clean text)
    const sanitized = sanitizeEmailContent(input.textBody, input.htmlBody);

    const emailId = nanoid();
    const now = new Date();

    const normalizedFlags: EmailFlags = {
      unread: input.flags.unread,
      starred: input.flags.starred || false,
      draft: input.flags.draft || false,
      archived: input.flags.archived || false,
      bulk: input.flags.bulk || sanitized.hasTrackingPixels,
      automated: input.flags.automated,
      hasListUnsubscribe: input.flags.hasListUnsubscribe,
      transactional: input.flags.transactional || false,
    };

    // Check if message was already ingested (idempotent upsert)
    const [existing] = await db
      .select()
      .from(schema.emails)
      .where(
        and(
          eq(schema.emails.tenantId, principal.tenantId),
          eq(schema.emails.accountId, input.accountId),
          eq(schema.emails.providerMessageId, input.providerMessageId)
        )
      )
      .limit(1);

    if (existing) {
      return this.mapDbEmailToDomain(existing);
    }

    // Insert normalized email
    await db.insert(schema.emails).values({
      id: emailId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId: input.accountId,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      providerThreadId: input.providerThreadId || null,
      fromAddress: input.from.address.toLowerCase().trim(),
      fromName: input.from.name || null,
      toAddresses: input.to,
      ccAddresses: input.cc || [],
      bccAddresses: input.bcc || [],
      replyToAddresses: input.replyTo || [],
      subject: input.subject || "(No Subject)",
      textBody: sanitized.plainText,
      htmlBody: sanitized.safeHtml || null,
      snippet: sanitized.plainText.slice(0, 200).replace(/\s+/g, " "),
      receivedAt: input.receivedAt,
      sentAt: input.sentAt || null,
      headers: input.headers || {},
      flags: normalizedFlags,
      createdAt: now,
      updatedAt: now,
    });

    // Save attachment metadata
    if (input.attachments && input.attachments.length > 0) {
      for (const att of input.attachments) {
        await db.insert(schema.emailAttachments).values({
          id: nanoid(),
          tenantId: principal.tenantId,
          userId: principal.userId,
          emailId,
          filename: att.filename,
          contentType: att.contentType || null,
          size: att.size || null,
          contentHash: att.contentHash || null,
          contentUrl: att.contentUrl || null,
          createdAt: now,
        });
      }
    }

    // Record sender profile update
    await relationshipService.recordMessageReceived(
      principal,
      input.from.address,
      input.from.name
    );

    // Update thread state if providerThreadId exists
    if (input.providerThreadId) {
      await this.updateThreadState(principal, input.accountId, input.providerThreadId, input);
    }

    const savedEmail = await this.getEmail(principal, emailId);

    // Build replayable L2 facts and indexed event membership before any legacy
    // compatibility classification runs. Neither step writes semantic judgment.
    await triageEventService.recordMessage(principal, savedEmail, now);

    // Extract deterministic signals & persist initial classification
    const signals = await intelligenceService.extractSignals(principal, savedEmail);
    const classification = await intelligenceService.classifyEmail(principal, savedEmail, signals);

    // Evaluate and execute configured user mail policies (respecting dry-run mode)
    const policyEvaluation = await policyService.evaluatePolicies(principal, savedEmail, classification, signals);
    await policyService.executePolicy(principal, savedEmail, policyEvaluation);

    return savedEmail;
  }

  /**
   * Retrieves a single email by ID enforcing strict tenant & user ownership
   */
  async getEmail(principal: AuthPrincipal, messageId: string): Promise<NormalizedEmail> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const context = await organizationService.requireWorkspaceMembership(principal, principal.tenantId);

    const [row] = await db
      .select()
      .from(schema.emails)
      .where(
        and(
          eq(schema.emails.id, messageId),
          eq(schema.emails.tenantId, principal.tenantId),
          ...(context.workspace.kind === "personal" ? [eq(schema.emails.userId, principal.userId)] : [])
        )
      )
      .limit(1);

    if (!row) {
      throw new NotFoundError("Email message", messageId);
    }

    const attachments = await db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(
          eq(schema.emailAttachments.emailId, messageId),
          eq(schema.emailAttachments.tenantId, principal.tenantId)
        )
      );

    return {
      ...this.mapDbEmailToDomain(row),
      attachments: attachments.map((att: any) => ({
        id: att.id,
        filename: att.filename,
        contentType: att.contentType || undefined,
        size: att.size || undefined,
        contentHash: att.contentHash || undefined,
        contentUrl: att.contentUrl || undefined,
      })),
    };
  }

  /**
   * Retrieves bounded thread messages (default recent 5 messages)
   */
  async getThread(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string,
    limit: number = 5
  ): Promise<{ threadState?: ThreadState; messages: NormalizedEmail[] }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const context = await organizationService.requireWorkspaceMembership(principal, principal.tenantId);

    // Fetch thread messages ordered chronologically
    const rows = await db
      .select()
      .from(schema.emails)
      .where(
        and(
          eq(schema.emails.tenantId, principal.tenantId),
          ...(context.workspace.kind === "personal" ? [eq(schema.emails.userId, principal.userId)] : []),
          eq(schema.emails.accountId, accountId),
          eq(schema.emails.providerThreadId, threadId)
        )
      )
      .orderBy(desc(schema.emails.receivedAt))
      .limit(limit);

    const messages = rows.reverse().map((r: any) => this.mapDbEmailToDomain(r));

    const [stateRow] = await db
      .select()
      .from(schema.threadStates)
      .where(
        and(
          eq(schema.threadStates.tenantId, principal.tenantId),
          ...(context.workspace.kind === "personal" ? [eq(schema.threadStates.userId, principal.userId)] : []),
          eq(schema.threadStates.accountId, accountId),
          eq(schema.threadStates.providerThreadId, threadId)
        )
      )
      .limit(1);

    const threadState: ThreadState | undefined = stateRow
      ? {
          id: stateRow.id,
          tenantId: stateRow.tenantId,
          userId: stateRow.userId,
          accountId: stateRow.accountId,
          providerThreadId: stateRow.providerThreadId,
          title: stateRow.title || undefined,
          participantEmails: stateRow.participantEmails,
          projectIds: stateRow.projectIds,
          organizationIds: stateRow.organizationIds,
          summary: stateRow.summary || undefined,
          openLoops: (stateRow.openLoops || []).map((l: any) => ({
            id: l.id,
            type: l.type,
            description: l.description,
            dueAt: l.dueAt ? new Date(l.dueAt) : undefined,
            resolved: Boolean(l.resolved),
          })),
          lastActivityAt: stateRow.lastActivityAt,
          messageCount: stateRow.messageCount,
          createdAt: stateRow.createdAt,
          updatedAt: stateRow.updatedAt,
        }
      : undefined;

    return { threadState, messages };
  }

  /**
   * Structured cross-account search
   */
  async searchMail(
    principal: AuthPrincipal,
    params: MailSearchParams
  ): Promise<{ total: number; messages: NormalizedEmail[] }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.search");
    const context = await organizationService.requireWorkspaceMembership(principal, principal.tenantId);

    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    let conditions: any[] = [
      eq(schema.emails.tenantId, principal.tenantId),
    ];
    if (context.workspace.kind === "personal") conditions.push(eq(schema.emails.userId, principal.userId));

    if (params.accountId) {
      conditions.push(eq(schema.emails.accountId, params.accountId));
    }

    if (params.senderEmail) {
      conditions.push(eq(schema.emails.fromAddress, params.senderEmail.toLowerCase().trim()));
    }

    if (params.unreadOnly) {
      conditions.push(like(schema.emails.flags, '%"unread":true%'));
    }

    if (params.query) {
      const q = `%${params.query.toLowerCase().trim()}%`;
      conditions.push(
        or(
          like(schema.emails.subject, q),
          like(schema.emails.fromAddress, q),
          like(schema.emails.fromName, q),
          like(schema.emails.textBody, q)
        )
      );
    }

    if (params.startDate) {
      conditions.push(gte(schema.emails.receivedAt, params.startDate));
    }

    if (params.endDate) {
      conditions.push(lte(schema.emails.receivedAt, params.endDate));
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.emails)
      .where(and(...conditions));

    const total = Number(countRow?.count || 0);

    const rows = await db
      .select()
      .from(schema.emails)
      .where(and(...conditions))
      .orderBy(desc(schema.emails.receivedAt))
      .limit(limit)
      .offset(offset);

    let messages = rows.map((r: any) => this.mapDbEmailToDomain(r));

    if (params.unreadOnly) {
      messages = messages.filter((m: any) => m.flags?.unread);
    }

    return {
      total,
      messages,
    };
  }

  /**
   * Mailbox state actions (markRead, markUnread, archive) respecting dry-run mode
   */
  async mutateMailboxState(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string,
    action: MailboxActionType
  ): Promise<{ action: MailboxActionType; simulated: boolean; success: boolean }> {
    authService.requirePrincipal(principal);
    const context = await organizationService.requireWorkspaceMembership(principal, principal.tenantId);

    if (action === "archive") {
      authService.requireScope(principal, "mail.archive");
    } else {
      authService.requireScope(principal, "mail.modify");
    }

    const email = await this.getEmail(principal, messageId);

    const isDryRun = !config.MAILBOX_MUTATIONS_ENABLED;
    const now = new Date();

    if (!isDryRun) {
      // Update database flags
      const flags = { ...email.flags };
      if (action === "mark_read") flags.unread = false;
      if (action === "mark_unread") flags.unread = true;
      if (action === "archive") flags.archived = true;

      await db
        .update(schema.emails)
        .set({ flags, updatedAt: now })
        .where(
          and(
            eq(schema.emails.id, messageId),
            eq(schema.emails.tenantId, principal.tenantId),
            ...(context.workspace.kind === "personal" ? [eq(schema.emails.userId, principal.userId)] : [])
          )
        );
    }

    // Record action log
    await db.insert(schema.mailboxActions).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      messageId,
      action,
      status: isDryRun ? "simulated" : "success",
      createdAt: now,
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: isDryRun
        ? "DRY_RUN_MUTATION_SIMULATED"
        : action === "mark_read"
        ? "MAIL_MARK_READ"
        : action === "mark_unread"
        ? "MAIL_MARK_UNREAD"
        : "MAIL_ARCHIVE",
      resourceType: "email",
      resourceId: messageId,
      status: isDryRun ? "simulated" : "success",
      details: { accountId, action, simulated: isDryRun },
    });

    if (isDryRun) {
      logger.info(`[DRY RUN] Mailbox mutation simulated: WOULD_${action.toUpperCase()} for message=${messageId}`);
    }

    return {
      action,
      simulated: isDryRun,
      success: true,
    };
  }

  private async updateThreadState(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string,
    email: Partial<NormalizedEmail>
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(schema.threadStates)
      .where(
        and(
          eq(schema.threadStates.tenantId, principal.tenantId),
          eq(schema.threadStates.userId, principal.userId),
          eq(schema.threadStates.accountId, accountId),
          eq(schema.threadStates.providerThreadId, threadId)
        )
      )
      .limit(1);

    const now = new Date();
    const fromAddr = email.from?.address?.toLowerCase() || "";
    const toAddrs = (email.to || []).map((t) => t.address.toLowerCase());
    const participants = Array.from(new Set([fromAddr, ...toAddrs].filter(Boolean)));

    // Detect open loop: question or pending reply
    const openLoops: Array<{
      id: string;
      type: "user_owes_reply" | "other_party_owes_reply" | "pending_action" | "pending_decision";
      description: string;
      dueAt?: string;
      resolved: boolean;
    }> = [];
    const text = (email.textBody || "").toLowerCase();
    if (text.includes("?") || text.includes("could you") || text.includes("please let me know")) {
      openLoops.push({
        id: nanoid(),
        type: "user_owes_reply",
        description: `Sender asked question in message: "${email.subject || "No subject"}"`,
        dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        resolved: false,
      });
    }

    if (existing) {
      const mergedParticipants = Array.from(new Set([...existing.participantEmails, ...participants]));
      await db
        .update(schema.threadStates)
        .set({
          participantEmails: mergedParticipants,
          messageCount: existing.messageCount + 1,
          lastActivityAt: now,
          updatedAt: now,
          ...(openLoops.length > 0 ? { openLoops } : {}),
        })
        .where(eq(schema.threadStates.id, existing.id));
    } else {
      await db.insert(schema.threadStates).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        accountId,
        providerThreadId: threadId,
        title: email.subject || "Email Thread",
        participantEmails: participants,
        projectIds: [],
        organizationIds: [],
        summary: email.snippet || null,
        openLoops,
        messageCount: 1,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private mapDbEmailToDomain(row: typeof schema.emails.$inferSelect): NormalizedEmail {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      accountId: row.accountId,
      provider: row.provider as any,
      providerMessageId: row.providerMessageId,
      providerThreadId: row.providerThreadId || undefined,
      from: { name: row.fromName || undefined, address: row.fromAddress },
      to: row.toAddresses || [],
      cc: row.ccAddresses || [],
      bcc: row.bccAddresses || [],
      replyTo: row.replyToAddresses || undefined,
      subject: row.subject,
      textBody: row.textBody,
      htmlBody: row.htmlBody || undefined,
      snippet: row.snippet || undefined,
      receivedAt: row.receivedAt,
      sentAt: row.sentAt || undefined,
      headers: row.headers || {},
      flags: row.flags || { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const emailService = new EmailService();
