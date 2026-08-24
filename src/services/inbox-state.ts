import { and, desc, eq, isNull } from "drizzle-orm";
import { refreshTemporalFacts, type TriageFacts } from "@mailwarden/triage-features";
import { applyPolicyClamps } from "@mailwarden/triage-priority";
import type { ExternalTriageDecision } from "@mailwarden/triage-contract";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import { authService } from "./auth";
import { triageService } from "./triage";
import { ValidationError } from "../utils/errors";

function mergeFacts(items: TriageFacts[]): TriageFacts | null {
  const latest = items.at(-1);
  if (!latest) return null;
  return {
    ...latest,
    amounts: items.flatMap((item) => item.amounts),
    entityIds: items.flatMap((item) => item.entityIds),
    deadlines: items.flatMap((item) => item.deadlines),
    credentials: items.flatMap((item) => item.credentials),
    errors: items.flatMap((item) => item.errors),
    paymentEvents: items.flatMap((item) => item.paymentEvents),
    securityEvents: items.flatMap((item) => item.securityEvents),
    infrastructureEvents: items.flatMap((item) => item.infrastructureEvents),
  };
}

export class InboxStateService {
  async getInboxState(principal: AuthPrincipal, options: { limit?: number; now?: Date } = {}) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const now = options.now ?? new Date();
    const requestedLimit = options.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new ValidationError("limit must be a positive integer");
    const limit = Math.min(requestedLimit, 200);
    const [events, uoc] = await Promise.all([
      db.select().from(schema.triageEvents).where(and(
        eq(schema.triageEvents.tenantId, principal.tenantId),
        eq(schema.triageEvents.userId, principal.userId),
        isNull(schema.triageEvents.mergedIntoEventId)
      )).orderBy(desc(schema.triageEvents.lastObservedAt)).limit(limit),
      triageService.getUserOperatingContext(principal),
    ]);
    const states = [];
    // ponytail: bounded N+1 over at most 200 events; batch contexts when mailbox metrics show this path needs it.
    for (const event of events) {
      const context = await triageService.getEventContext(principal, event.id);
      const canonicalEvent = context.event;
      const decision = context.previousDecision;
      const storedFacts = context.members.map((member: any) => member.facts).filter(Boolean) as TriageFacts[];
      const currentFacts = mergeFacts(storedFacts.map((facts) => refreshTemporalFacts(facts, now)));
      if (!decision || !currentFacts) {
        states.push({ event: canonicalEvent, members: context.members, decision: null, presentation: null, needsJudgment: true, needsReevaluation: false, staleReasons: [] });
        continue;
      }

      const judgment = decision.validatedJudgment as ExternalTriageDecision;
      const currentFactsVersion = [...new Set(context.members.map((member: any) => member.factsVersion).filter(Boolean))].sort().join(",");
      const staleReasons: string[] = [];
      if (decision.factsVersion !== currentFactsVersion) staleReasons.push("facts_version_changed");
      if (decision.uocVersion !== uoc.version) staleReasons.push("uoc_changed");
      if (canonicalEvent.lastObservedAt > decision.createdAt) staleReasons.push("event_gained_message");
      if (canonicalEvent.observedState === "resolved" && judgment.status !== "resolved") staleReasons.push("event_status_changed");
      for (let index = 0; index < storedFacts.length; index++) {
        if (JSON.stringify(storedFacts[index]!.deadlines) !== JSON.stringify(refreshTemporalFacts(storedFacts[index]!, now).deadlines)) staleReasons.push("deadline_crossed");
        if (JSON.stringify(storedFacts[index]!.credentials) !== JSON.stringify(refreshTemporalFacts(storedFacts[index]!, now).credentials)) staleReasons.push("credential_expired");
      }
      const uniqueReasons = [...new Set(staleReasons)];
      const needsReevaluation = Boolean(decision.needsReevaluation || uniqueReasons.length);
      if (needsReevaluation && !decision.needsReevaluation) {
        await db.update(schema.triageDecisions).set({ needsReevaluation: true }).where(eq(schema.triageDecisions.id, decision.id));
      }
      const presentation = applyPolicyClamps(judgment, currentFacts, { observedState: canonicalEvent.observedState }).presentation;
      states.push({
        event: canonicalEvent,
        members: context.members,
        decision: { ...decision, needsReevaluation },
        presentation,
        needsJudgment: false,
        needsReevaluation,
        staleReasons: uniqueReasons,
      });
    }

    const action = states.filter((state) => state.presentation?.lane === "action" && state.presentation.band !== "noise");
    const briefing = states.filter((state) => state.presentation?.lane === "briefing" && state.presentation.band !== "noise");
    return {
      generatedAt: now.toISOString(),
      totals: {
        events: states.length,
        needsJudgment: states.filter((state) => state.needsJudgment).length,
        needsReevaluation: states.filter((state) => state.needsReevaluation).length,
        actionRequired: action.length,
        briefing: briefing.length,
        p0: states.filter((state) => state.presentation?.band === "P0").length,
        p1: states.filter((state) => state.presentation?.band === "P1").length,
        suppressed: states.filter((state) => state.presentation?.band === "noise").length,
      },
      actionQueue: action,
      briefingLane: briefing,
      events: states,
    };
  }
}

export const inboxStateService = new InboxStateService();
