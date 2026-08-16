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

export class AttentionService {
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
      const unreadEmails = await db
        .select({ id: schema.emails.id })
        .from(schema.emails)
        .where(
          and(
            eq(schema.emails.tenantId, principal.tenantId),
            eq(schema.emails.userId, principal.userId),
            eq(schema.emails.accountId, acc.id)
          )
        );

      accountSummaries.push({
        id: acc.id,
        displayName: acc.displayName,
        provider: acc.provider,
        emailAddress: acc.emailAddress,
        status,
        statusText,
        priorityRole: acc.priorityRole,
        unreadCount: unreadEmails.length,
      });

      if (status === "error" || status === "reauth_required") {
        accountProblems.push({
          accountId: acc.id,
          displayName: acc.displayName,
          error: acc.errorMessage || `Account status is ${status}`,
        });
      }
    }

    // 2. Compute attention items
    const attentionQueue = await this.getAttentionQueue(principal, { limit: 10 });

    // 3. Compute totals
    const classifications = await db
      .select()
      .from(schema.classifications)
      .where(
        and(
          eq(schema.classifications.tenantId, principal.tenantId),
          eq(schema.classifications.userId, principal.userId)
        )
      );

    let actionRequired = 0;
    let waitingForReply = 0;
    let important = 0;
    let routine = 0;

    for (const c of classifications) {
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
    options: { limit?: number; minScore?: number } = {}
  ): Promise<AttentionItem[]> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");

    const limit = options.limit || 20;
    const minScore = options.minScore || 30;

    // Fetch user policies to factor into ranking
    const policies = await policyService.getUserPolicies(principal);
    const activePolicies = policies.filter((p) => p.enabled);

    // Fetch recent emails
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
      .limit(50);

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

    for (const email of emails) {
      const acc = accountMap.get(email.accountId);
      const accName = acc?.displayName || "Unknown Account";
      const fromAddr = email.fromAddress.toLowerCase().trim();

      // Fetch classification
      const [cls] = await db
        .select()
        .from(schema.classifications)
        .where(
          and(
            eq(schema.classifications.tenantId, principal.tenantId),
            eq(schema.classifications.userId, principal.userId),
            eq(schema.classifications.emailId, email.id)
          )
        )
        .limit(1);

      // Fetch relationship
      const relContext = await relationshipService.getRelationshipContext(principal, email.fromAddress);

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

      // Classification importance
      if (cls?.importance === "critical") {
        score += 35;
        reasons.push("Critical priority level");
      } else if (cls?.importance === "high") {
        score += 20;
        reasons.push("High priority level");
      } else if (cls?.importance === "low") {
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
      if (cls?.workflowState === "action_required") {
        score += 20;
        reasons.push("Action required from user");
      }

      if (cls?.deadline) {
        score += 15;
        reasons.push(`Explicit deadline identified: ${cls.deadline}`);
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
          importance: (cls?.importance || "normal") as ImportanceLevel,
          workflowState: (cls?.workflowState || "fyi") as WorkflowState,
          timeSensitivity: (cls?.timeSensitivity || "none") as TimeSensitivity,
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
