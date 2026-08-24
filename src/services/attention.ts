import { db, schema } from "../db";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type {
  AttentionItem,
  InboxStatusSummary,
  ImportanceLevel,
  WorkflowState,
  TimeSensitivity,
} from "../types/intelligence";
import { authService } from "./auth";
import { relationshipService } from "./relationships";
import { protonConnectorService } from "./proton-connector";
import { policyService } from "./policy";
import { userPreferencesService } from "./user-preferences";
import { localizationService } from "./localization";

/**
 * Inbox status totals and the attention queue MUST derive from the same candidate
 * set. When they had different denominators the two numbers could not be reconciled
 * (`needsAttention: 10` alongside `actionRequired: 0`).
 * ponytail: fixed window; replaced by event state in the clustering step.
 */
const TRIAGE_CANDIDATE_LIMIT = 100;

/**
 * A verification code stops being usable once it expires. That is a fact about the
 * credential, NOT a statement about the message's importance, so it may only ever be
 * applied to messages that actually carry a code. Widening this to
 * `category === "security"` suppressed every genuine security alert after 15 minutes.
 * ponytail: fixed TTL; replaced by the TTL stated in the message during feature extraction.
 */
const CREDENTIAL_TTL_MS = 15 * 60 * 1000;
const CREDENTIAL_PATTERN =
  /verification code|one-time password|one time password|login code|confirmation code|security code|passcode/i;

interface TriageCandidate {
  email: any;
  classification: any | undefined;
  importance: ImportanceLevel;
  workflowState: WorkflowState;
  timeSensitivity: TimeSensitivity;
  credentialExpired: boolean;
}

export class AttentionService {
  /** True only when the message itself carries a verification code. */
  private carriesCredential(email: { subject?: string | null; snippet?: string | null }): boolean {
    return CREDENTIAL_PATTERN.test(email.subject || "") || CREDENTIAL_PATTERN.test(email.snippet || "");
  }

  /**
   * Single source of truth for "which messages are we currently reasoning about".
   * Both getInboxStatus totals and getAttentionQueue derive from this so their
   * counts always share a denominator.
   */
  private async loadTriageCandidates(
    principal: AuthPrincipal,
    limit: number = TRIAGE_CANDIDATE_LIMIT
  ): Promise<TriageCandidate[]> {
    const emails = await db
      .select()
      .from(schema.emails)
      .where(
        and(
          eq(schema.emails.tenantId, principal.tenantId),
          eq(schema.emails.userId, principal.userId)
        )
      )
      .orderBy(desc(schema.emails.receivedAt))
      .limit(limit);

    if (emails.length === 0) return [];

    const rows = await db
      .select()
      .from(schema.classifications)
      .where(
        and(
          eq(schema.classifications.tenantId, principal.tenantId),
          eq(schema.classifications.userId, principal.userId),
          inArray(
            schema.classifications.emailId,
            emails.map((e: any) => e.id)
          )
        )
      );
    const byEmailId = new Map<string, any>(rows.map((r: any) => [r.emailId, r]));

    const nowMs = Date.now();
    return emails.map((email: any) => {
      const cls = byEmailId.get(email.id);
      const credentialExpired =
        this.carriesCredential(email) &&
        nowMs - new Date(email.receivedAt).getTime() > CREDENTIAL_TTL_MS;

      const workflowState: WorkflowState =
        credentialExpired && cls?.workflowState === "action_required"
          ? "automated"
          : (cls?.workflowState as WorkflowState) || "fyi";
      const importance: ImportanceLevel =
        credentialExpired && (cls?.importance === "critical" || cls?.importance === "high")
          ? "low"
          : (cls?.importance as ImportanceLevel) || "normal";
      const timeSensitivity: TimeSensitivity = credentialExpired
        ? "none"
        : (cls?.timeSensitivity as TimeSensitivity) || "none";

      return { email, classification: cls, importance, workflowState, timeSensitivity, credentialExpired };
    });
  }

  /**
   * Generates cross-account inbox status overview including provider health and connector status
   */
  async getInboxStatus(principal: AuthPrincipal): Promise<InboxStatusSummary & {
    activePreset?: string;
    onboardingCompleted?: boolean;
    providerWarnings?: string[];
  }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");

    const prefs = await userPreferencesService.getPreferences(principal);
    const locale = localizationService.resolveLocale({ savedPreference: prefs.preferredLanguage });

    // 1. Fetch connected accounts
    const accounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(
        and(
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        )
      );

    const accountSummaries = [];
    const accountProblems = [];
    const providerWarnings: string[] = [];

    for (const acc of accounts) {
      let status = acc.status;
      let statusText = acc.status;

      // For Proton accounts, check connector health
      if (acc.provider === "proton") {
        const connector = await protonConnectorService.getConnectorByAccountId(principal, acc.id);
        const formatted = protonConnectorService.formatConnectorStatus(connector, locale);

        if (!formatted.isOnline) {
          status = "offline";
          if (formatted.warningMessage) {
            providerWarnings.push(formatted.warningMessage);
            accountProblems.push({
              accountId: acc.id,
              displayName: acc.displayName,
              error: formatted.warningMessage,
            });
          }
        }
        statusText = formatted.statusText;
      }

      // Count unread for this account
      const accountEmails = await db
        .select({ id: schema.emails.id, flags: schema.emails.flags })
        .from(schema.emails)
        .where(
          and(
            eq(schema.emails.tenantId, principal.tenantId),
            eq(schema.emails.userId, principal.userId),
            eq(schema.emails.accountId, acc.id)
          )
        );

      const unreadCount = (accountEmails as any[]).filter((e: any) => Boolean((e.flags as any)?.unread)).length;

      accountSummaries.push({
        id: acc.id,
        displayName: acc.displayName,
        provider: acc.provider,
        emailAddress: acc.emailAddress,
        status,
        statusText,
        priorityRole: acc.priorityRole,
        unreadCount,
      });

      if (status === "error" || status === "reauth_required") {
        accountProblems.push({
          accountId: acc.id,
          displayName: acc.displayName,
          error: acc.errorMessage || `Account status is ${status}`,
        });
      }
    }

    // 2. Load the shared candidate set, then derive both the queue and the totals
    // from it so the reported numbers are mutually consistent.
    const candidates = await this.loadTriageCandidates(principal);
    const attentionQueue = await this.getAttentionQueue(principal, { limit: 10, candidates });

    // 3. Compute totals over the same candidates
    let actionRequired = 0;
    let waitingForReply = 0;
    let important = 0;
    let routine = 0;

    for (const c of candidates) {
      if (c.workflowState === "action_required") actionRequired++;
      if (c.workflowState === "waiting_for_reply") waitingForReply++;
      if (c.importance === "critical" || c.importance === "high") important++;
      if (c.importance === "normal" || c.importance === "low") routine++;
    }

    const totalUnread = accountSummaries.reduce((sum, a) => sum + a.unreadCount, 0);

    return {
      accounts: accountSummaries,
      totals: {
        unread: totalUnread,
        unprocessed: 0,
        needsAttention: attentionQueue.length,
        actionRequired,
        waitingForReply,
        important,
        routine,
      },
      topAttentionItems: attentionQueue.slice(0, 5),
      accountProblems,
      activePreset: prefs.selectedPreset,
      onboardingCompleted: prefs.onboardingCompleted,
      providerWarnings: providerWarnings.length > 0 ? providerWarnings : undefined,
    };
  }

  /**
   * Generates a ranked attention queue with explainability reasons and policy influence
   */
  async getAttentionQueue(
    principal: AuthPrincipal,
    options: { limit?: number; minScore?: number; candidates?: TriageCandidate[] } = {}
  ): Promise<AttentionItem[]> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");

    const limit = options.limit || 20;
    const minScore = options.minScore || 30;

    // Fetch user policies to factor into ranking
    const policies = await policyService.getUserPolicies(principal);
    const activePolicies = policies.filter((p) => p.enabled);

    // Reuse the caller's candidate set when given one so totals and the queue
    // are always computed over identical messages.
    const candidates = options.candidates ?? (await this.loadTriageCandidates(principal));

    // Fetch accounts map
    const accounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(
        and(
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        )
      );
    const accountMap = new Map<string, any>(accounts.map((a: any) => [a.id, a]));

    const attentionItems: AttentionItem[] = [];
    // Senders repeat heavily in a mailbox; look each one up once.
    const relationshipCache = new Map<string, any>();

    for (const candidate of candidates) {
      const { email, classification: cls } = candidate;
      const acc = accountMap.get(email.accountId);
      const accName = acc?.displayName || "Unknown Account";
      const fromAddr = email.fromAddress.toLowerCase().trim();

      // Fetch relationship
      let relContext = relationshipCache.get(fromAddr);
      if (!relContext) {
        relContext = await relationshipService.getRelationshipContext(principal, email.fromAddress);
        relationshipCache.set(fromAddr, relContext);
      }

      // Calculate attention score (0 - 100)
      let score = 50;
      const reasons: string[] = [];

      // Account priority multiplier
      if (acc?.priorityRole === "primary_work") {
        score += 10;
        reasons.push("From primary work mailbox");
      }

      // Check for user-defined matching policies
      const matchingSenderPolicy = activePolicies.find(
        (p) => p.scope === "sender" && p.targetValue?.toLowerCase() === fromAddr
      );
      if (matchingSenderPolicy) {
        if (matchingSenderPolicy.action === "surface" || matchingSenderPolicy.action === "prioritize" || matchingSenderPolicy.classification === "critical") {
          score += 30;
          reasons.push(`User rule: ${matchingSenderPolicy.name}`);
        } else if (matchingSenderPolicy.action === "archive") {
          score -= 40;
        }
      }

      const matchingRelPolicy = activePolicies.find(
        (p) => p.scope === "relationship" && p.targetValue?.toLowerCase() === relContext.relationship?.type
      );
      if (matchingRelPolicy) {
        if (matchingRelPolicy.action === "surface" || matchingRelPolicy.action === "prioritize") {
          score += 20;
          reasons.push(`Relationship rule: ${matchingRelPolicy.name}`);
        }
      }

      // Credential expiry is already resolved on the shared candidate.
      const isExpiredOtp = candidate.credentialExpired;
      const effectiveWorkflowState = candidate.workflowState;
      const effectiveImportance = candidate.importance;
      const effectiveTimeSensitivity = candidate.timeSensitivity;

      // Classification importance
      if (effectiveImportance === "critical") {
        score += 35;
        reasons.push("Critical priority level");
      } else if (effectiveImportance === "high") {
        score += 20;
        reasons.push("High priority level");
      } else if (effectiveImportance === "low") {
        score -= 25;
      }

      // Relationship boost
      if (relContext.relationship?.type === "client") {
        score += 25;
        reasons.push(`Known client (${relContext.relationship.userDefined ? "user confirmed" : "inferred"})`);
      } else if (relContext.relationship?.type === "employer" || relContext.relationship?.type === "coworker") {
        score += 15;
        reasons.push(`Colleague / Employer (${relContext.relationship.type})`);
      } else if (relContext.relationship?.type === "recruiter") {
        score += 15;
        reasons.push("Recruiter / career contact");
      }

      // Open loop / reply owed
      if (effectiveWorkflowState === "action_required") {
        score += 20;
        reasons.push("Action required from user");
      }

      if (cls?.deadline) {
        score += 15;
        reasons.push(`Explicit deadline identified: ${cls.deadline}`);
      }

      if (isExpiredOtp) {
        score -= 30;
      }

      // Bulk or newsletter penalty
      if (email.flags?.bulk || email.flags?.hasListUnsubscribe) {
        score -= 30;
      }

      // Clamp score
      score = Math.max(0, Math.min(100, score));

      if (score >= minScore) {
        attentionItems.push({
          messageId: email.id,
          threadId: email.providerThreadId || undefined,
          accountId: email.accountId,
          accountDisplayName: accName,
          from: { name: email.fromName || undefined, address: email.fromAddress },
          subject: email.subject,
          snippet: email.snippet || "",
          receivedAt: email.receivedAt.toISOString(),
          importance: effectiveImportance as ImportanceLevel,
          workflowState: effectiveWorkflowState as WorkflowState,
          timeSensitivity: effectiveTimeSensitivity as TimeSensitivity,
          relationshipType: relContext.relationship?.type,
          attentionScore: score,
          reasons: reasons.length > 0 ? reasons : ["Recent unread communication"],
        });
      }
    }

    // Sort descending by attention score
    return attentionItems.sort((a, b) => b.attentionScore - a.attentionScore).slice(0, limit);
  }

  /**
   * Retrieves messages and threads where the authenticated user owes an action or reply
   */
  async getWaitingForUser(principal: AuthPrincipal, limit: number = 10): Promise<AttentionItem[]> {
    const queue = await this.getAttentionQueue(principal, { limit: 50, minScore: 40 });
    return queue.filter((item) => item.workflowState === "action_required").slice(0, limit);
  }

  /**
   * Retrieves threads where the user is waiting for an external party (reply, decision, action)
   */
  async getUserWaitingFor(principal: AuthPrincipal, limit: number = 10): Promise<Array<{
    threadId: string;
    title: string;
    participants: string[];
    waitingCategory: "other_party_owes_reply" | "pending_decision" | "pending_action";
    description: string;
    lastActivityAt: string;
  }>> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");

    const threads = await db
      .select()
      .from(schema.threadStates)
      .where(
        and(
          eq(schema.threadStates.tenantId, principal.tenantId),
          eq(schema.threadStates.userId, principal.userId)
        )
      )
      .orderBy(desc(schema.threadStates.lastActivityAt))
      .limit(limit * 2);

    const results: Array<{
      threadId: string;
      title: string;
      participants: string[];
      waitingCategory: "other_party_owes_reply" | "pending_decision" | "pending_action";
      description: string;
      lastActivityAt: string;
    }> = [];

    for (const t of threads) {
      const openLoops = (t.openLoops || []).filter((l: any) => !l.resolved);
      const waitingLoop = openLoops.find(
        (l: any) =>
          l.type === "other_party_owes_reply" ||
          l.type === "pending_decision" ||
          l.type === "pending_action"
      );

      if (waitingLoop) {
        results.push({
          threadId: t.providerThreadId,
          title: t.title || "Thread",
          participants: t.participantEmails,
          waitingCategory: waitingLoop.type as any,
          description: waitingLoop.description,
          lastActivityAt: t.lastActivityAt.toISOString(),
        });
      } else {
        // If thread has multiple messages and user sent last, record as waiting for reply
        results.push({
          threadId: t.providerThreadId,
          title: t.title || "Thread",
          participants: t.participantEmails,
          waitingCategory: "other_party_owes_reply",
          description: `Awaiting response from ${t.participantEmails.join(", ")}`,
          lastActivityAt: t.lastActivityAt.toISOString(),
        });
      }

      if (results.length >= limit) break;
    }

    return results;
  }
}

export const attentionService = new AttentionService();
