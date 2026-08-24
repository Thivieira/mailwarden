import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import type { AttentionItem, ImportanceLevel, InboxStatusSummary, TimeSensitivity, WorkflowState } from "../types/intelligence";
import { authService } from "./auth";
import { inboxStateService } from "./inbox-state";
import { localizationService } from "./localization";
import { protonConnectorService } from "./proton-connector";
import { userPreferencesService } from "./user-preferences";

const BAND_COMPATIBILITY = {
  P0: { importance: "critical", score: 100 },
  P1: { importance: "high", score: 80 },
  P2: { importance: "normal", score: 60 },
  P3: { importance: "low", score: 40 },
  noise: { importance: "low", score: 0 },
} as const;

function compatibilityItem(state: any, accountNames: Map<string, string>): AttentionItem | null {
  const member = state.members?.at(-1);
  if (!member) return null;
  const judgment = state.decision?.validatedJudgment;
  const band = state.presentation?.band as keyof typeof BAND_COMPATIBILITY | undefined;
  const compatibility = band ? BAND_COMPATIBILITY[band] : { importance: "normal" as const, score: 30 };
  const workflowState: WorkflowState = !judgment
    ? "fyi"
    : state.presentation.lane === "action"
      ? "action_required"
      : judgment.waitingOn === "counterparty"
        ? "waiting_for_reply"
        : state.presentation.lane === "suppressed"
          ? "automated"
          : "fyi";
  const timeSensitivity: TimeSensitivity = judgment?.timeCriticality === "now"
    ? "immediate"
    : judgment?.timeCriticality === "today"
      ? "today"
      : ["this_week", "this_month"].includes(judgment?.timeCriticality)
        ? "soon"
        : "none";
  const reasons = judgment
    ? [judgment.rationale, ...(state.presentation.clampsApplied ?? []).map((clamp: any) => `Policy clamp: ${clamp.id}`)]
    : ["Awaiting external triage judgment"];
  return {
    messageId: member.messageId,
    threadId: member.providerThreadId,
    accountId: member.accountId,
    accountDisplayName: accountNames.get(member.accountId) ?? "Unknown Account",
    from: member.from,
    subject: member.subject ?? "",
    snippet: member.snippet ?? "",
    receivedAt: member.receivedAt,
    importance: compatibility.importance as ImportanceLevel,
    workflowState,
    timeSensitivity,
    relationshipType: judgment?.domain === "client" ? "client" : undefined,
    attentionScore: compatibility.score,
    reasons,
  };
}

export class AttentionService {
  async getInboxStatus(principal: AuthPrincipal): Promise<InboxStatusSummary & {
    activePreset?: string;
    onboardingCompleted?: boolean;
    providerWarnings?: string[];
  }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const prefs = await userPreferencesService.getPreferences(principal);
    const locale = localizationService.resolveLocale({ savedPreference: prefs.preferredLanguage });
    const accounts = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId)
    ));
    const accountSummaries = [];
    const accountProblems = [];
    const providerWarnings: string[] = [];
    for (const account of accounts) {
      let status = account.status;
      let statusText = account.status;
      if (account.provider === "proton") {
        const formatted = protonConnectorService.formatConnectorStatus(
          await protonConnectorService.getConnectorByAccountId(principal, account.id),
          locale
        );
        if (!formatted.isOnline) {
          status = "offline";
          if (formatted.warningMessage) {
            providerWarnings.push(formatted.warningMessage);
            accountProblems.push({ accountId: account.id, displayName: account.displayName, error: formatted.warningMessage });
          }
        }
        statusText = formatted.statusText;
      }
      const messages = await db.select({ flags: schema.emails.flags }).from(schema.emails).where(and(
        eq(schema.emails.tenantId, principal.tenantId),
        eq(schema.emails.userId, principal.userId),
        eq(schema.emails.accountId, account.id)
      ));
      accountSummaries.push({
        id: account.id,
        displayName: account.displayName,
        provider: account.provider,
        emailAddress: account.emailAddress,
        status,
        statusText,
        priorityRole: account.priorityRole,
        unreadCount: messages.filter((message: any) => Boolean(message.flags?.unread)).length,
      });
      if (status === "error" || status === "reauth_required") {
        accountProblems.push({ accountId: account.id, displayName: account.displayName, error: account.errorMessage || `Account status is ${status}` });
      }
    }

    const state = await inboxStateService.getInboxState(principal, { limit: 100 });
    const attentionQueue = await this.getAttentionQueue(principal, { limit: 100, minScore: 30, states: state.events });
    const important = state.events.filter((event: any) => event.presentation?.band === "P0" || event.presentation?.band === "P1").length;
    return {
      accounts: accountSummaries,
      totals: {
        unread: accountSummaries.reduce((sum, account) => sum + account.unreadCount, 0),
        unprocessed: state.totals.needsJudgment,
        needsAttention: attentionQueue.length,
        actionRequired: state.totals.actionRequired,
        waitingForReply: state.events.filter((event: any) => event.decision?.validatedJudgment?.waitingOn === "counterparty").length,
        important,
        routine: state.events.length - important,
      },
      topAttentionItems: attentionQueue.slice(0, 5),
      accountProblems,
      activePreset: prefs.selectedPreset,
      onboardingCompleted: prefs.onboardingCompleted,
      providerWarnings: providerWarnings.length ? providerWarnings : undefined,
    };
  }

  async getAttentionQueue(
    principal: AuthPrincipal,
    options: { limit?: number; minScore?: number; states?: any[] } = {}
  ): Promise<AttentionItem[]> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const limit = options.limit ?? 20;
    const minScore = options.minScore ?? 30;
    const states = options.states ?? (await inboxStateService.getInboxState(principal, { limit: 100 })).events;
    const accounts = await db.select({ id: schema.emailAccounts.id, displayName: schema.emailAccounts.displayName })
      .from(schema.emailAccounts)
      .where(and(eq(schema.emailAccounts.tenantId, principal.tenantId), eq(schema.emailAccounts.userId, principal.userId)));
    const accountNames = new Map<string, string>(accounts.map((account: any) => [account.id, account.displayName]));
    return states
      .map((state) => compatibilityItem(state, accountNames))
      .filter((item): item is AttentionItem => Boolean(item && item.attentionScore >= minScore))
      .sort((left, right) => right.attentionScore - left.attentionScore || right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, limit);
  }

  async getWaitingForUser(principal: AuthPrincipal, limit = 10): Promise<AttentionItem[]> {
    return (await this.getAttentionQueue(principal, { limit: 50, minScore: 0 }))
      .filter((item) => item.workflowState === "action_required")
      .slice(0, limit);
  }

  async getUserWaitingFor(principal: AuthPrincipal, limit = 10): Promise<Array<{
    threadId: string;
    title: string;
    participants: string[];
    waitingCategory: "other_party_owes_reply" | "pending_decision" | "pending_action";
    description: string;
    lastActivityAt: string;
  }>> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const threads = await db.select().from(schema.threadStates).where(and(
      eq(schema.threadStates.tenantId, principal.tenantId),
      eq(schema.threadStates.userId, principal.userId)
    )).orderBy(desc(schema.threadStates.lastActivityAt)).limit(limit * 2);
    return threads.slice(0, limit).map((thread: any) => {
      const waitingLoop = (thread.openLoops ?? []).find((loop: any) => !loop.resolved && ["other_party_owes_reply", "pending_decision", "pending_action"].includes(loop.type));
      return {
        threadId: thread.providerThreadId,
        title: thread.title || "Thread",
        participants: thread.participantEmails,
        waitingCategory: waitingLoop?.type ?? "other_party_owes_reply",
        description: waitingLoop?.description ?? `Awaiting response from ${thread.participantEmails.join(", ")}`,
        lastActivityAt: thread.lastActivityAt.toISOString(),
      };
    });
  }
}

export const attentionService = new AttentionService();
