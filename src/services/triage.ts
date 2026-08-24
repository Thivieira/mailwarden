import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  externalTriageDecisionSchema,
  validateExternalTriageDecision,
  type ExternalTriageDecision,
  type SuppliedTriageEvidence,
} from "@mailwarden/triage-contract";
import { applyPolicyClamps } from "@mailwarden/triage-priority";
import type { TriageFacts } from "@mailwarden/triage-features";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import { authService } from "./auth";
import { auditService } from "./audit";

interface SaveMetadata {
  name?: string;
  version?: string;
}

interface PreparedDecision {
  decision: ExternalTriageDecision;
  facts: TriageFacts;
  factsVersion: string;
  uocVersion: string;
  previousDecisionId?: string;
  presentation: ReturnType<typeof applyPolicyClamps>["presentation"];
}

function factPaths(facts: TriageFacts): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(facts)) {
    if (Array.isArray(value)) {
      value.forEach((_item, index) => paths.push(`${key}.${index}`));
    } else if (value && typeof value === "object") {
      for (const child of Object.keys(value)) paths.push(`${key}.${child}`);
    } else {
      paths.push(key);
    }
  }
  return paths;
}

function asFacts(value: unknown): TriageFacts {
  return value as TriageFacts;
}

export class TriageService {
  async getUserOperatingContext(principal: AuthPrincipal) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const owned = (table: any) => and(eq(table.tenantId, principal.tenantId), eq(table.userId, principal.userId));
    const [organizations, projects, relationships, senderProfiles, accounts] = await Promise.all([
      db.select().from(schema.organizations).where(owned(schema.organizations)),
      db.select().from(schema.projects).where(owned(schema.projects)),
      db.select().from(schema.relationships).where(owned(schema.relationships)),
      db.select().from(schema.senderProfiles).where(owned(schema.senderProfiles)),
      db.select().from(schema.emailAccounts).where(owned(schema.emailAccounts)),
    ]);
    return {
      version: "0",
      organizations,
      projects,
      relationships,
      senderProfiles: senderProfiles.map((profile: any) => ({
        id: profile.id,
        email: profile.email,
        domain: profile.domain,
        displayName: profile.displayName,
        messagesSeen: profile.messagesSeen,
        repliesFromUser: profile.repliesFromUser,
      })),
      accounts: accounts.map((account: any) => ({
        id: account.id,
        emailAddress: account.emailAddress,
        displayName: account.displayName,
        provider: account.provider,
        priorityRole: account.priorityRole,
      })),
    };
  }

  async getEventContext(principal: AuthPrincipal, eventId: string, includeBody = false) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const [event] = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.id, eventId),
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    )).limit(1);
    if (!event) throw new Error(`Triage event '${eventId}' not found`);

    const members = await db.select().from(schema.triageEventMembers).where(and(
      eq(schema.triageEventMembers.eventId, eventId),
      eq(schema.triageEventMembers.tenantId, principal.tenantId),
      eq(schema.triageEventMembers.userId, principal.userId)
    )).orderBy(asc(schema.triageEventMembers.observedAt));
    const ids = members.map((member: any) => member.emailId);
    const [messages, factsRows, previous] = await Promise.all([
      ids.length ? db.select().from(schema.emails).where(inArray(schema.emails.id, ids)) : [],
      ids.length ? db.select().from(schema.messageFacts).where(inArray(schema.messageFacts.emailId, ids)) : [],
      db.select().from(schema.triageDecisions).where(and(
        eq(schema.triageDecisions.eventId, eventId),
        eq(schema.triageDecisions.tenantId, principal.tenantId),
        eq(schema.triageDecisions.userId, principal.userId)
      )).orderBy(desc(schema.triageDecisions.createdAt)).limit(1),
    ]);
    const messageById = new Map(messages.map((message: any) => [message.id, message]));
    const factsById = new Map(factsRows.map((row: any) => [row.emailId, row]));

    return {
      event,
      members: members.map((member: any) => {
        const message: any = messageById.get(member.emailId);
        const factRow: any = factsById.get(member.emailId);
        return {
          messageId: member.emailId,
          membershipReason: member.membershipReason,
          supersededByMessageId: member.supersededByEmailId,
          from: message ? { address: message.fromAddress, name: message.fromName } : undefined,
          subject: message?.subject,
          snippet: message?.snippet,
          receivedAt: message?.receivedAt?.toISOString(),
          providerThreadId: message?.providerThreadId,
          ...(includeBody ? { textBody: message?.textBody } : {}),
          factsVersion: factRow?.featureVersion,
          facts: factRow?.facts,
          factPaths: factRow ? factPaths(asFacts(factRow.facts)) : [],
        };
      }),
      previousDecision: previous[0] ?? null,
    };
  }

  private policyHints(facts: TriageFacts[]) {
    return {
      detectedSecurityEvent: facts.some((item) => item.securityEvents.length > 0),
      failedPayment: facts.some((item) => item.paymentEvents.some((fact) => fact.value === "payment_failed" || fact.value === "payout_failed")),
      expiredCredential: facts.some((item) => item.credentials.some((fact) => fact.value.expirationState === "expired")),
      marketingDelivery: facts.some((item) => item.delivery.bulk === true || item.delivery.listUnsubscribe),
      authenticationFailure: facts.some((item) => item.auth.spf === "fail" || item.auth.dmarc === "fail"),
    };
  }

  async getTriageBatch(principal: AuthPrincipal, options: { limit?: number; timezone?: string; now?: Date } = {}) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const events = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    )).orderBy(desc(schema.triageEvents.lastObservedAt)).limit(limit * 3);
    const decisions = await db.select().from(schema.triageDecisions).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.userId, principal.userId)
    )).orderBy(desc(schema.triageDecisions.createdAt));
    const latest = new Map<string, any>();
    for (const row of decisions) if (!latest.has(row.eventId)) latest.set(row.eventId, row);
    const candidates = events.filter((event: any) => {
      const decision = latest.get(event.id);
      if (!decision || decision.needsReevaluation) return true;
      const status = (decision.validatedJudgment as ExternalTriageDecision).status;
      return status === "open" || status === "in_progress";
    }).slice(0, limit);
    const uoc = await this.getUserOperatingContext(principal);
    const contexts = [];
    for (const event of candidates) {
      const context = await this.getEventContext(principal, event.id);
      const facts = context.members.map((member: any) => member.facts).filter(Boolean) as TriageFacts[];
      contexts.push({
        ...context,
        userContext: uoc,
        changesSinceJudgment: context.previousDecision
          ? { messageCount: event.messageCount, needsReevaluation: Boolean(context.previousDecision.needsReevaluation) }
          : { firstJudgment: true, messageCount: event.messageCount },
        policyHints: this.policyHints(facts),
      });
    }
    return {
      protocolVersion: "1",
      currentTime: (options.now ?? new Date()).toISOString(),
      timezone: options.timezone ?? "UTC",
      eventCount: contexts.length,
      events: contexts,
      validOutputContract: (externalTriageDecisionSchema as any).toJSONSchema(),
    };
  }

  private async prepareDecision(principal: AuthPrincipal, input: unknown): Promise<PreparedDecision> {
    const parsed = externalTriageDecisionSchema.parse(input);
    const context = await this.getEventContext(principal, parsed.eventId);
    const uoc = await this.getUserOperatingContext(principal);
    const factPathsByMessage: Record<string, string[]> = {};
    for (const member of context.members) factPathsByMessage[member.messageId] = member.factPaths;
    const contextIds: Record<string, string[]> = {
      organization: uoc.organizations.map((row: any) => row.id),
      project: uoc.projects.map((row: any) => row.id),
      relationship: uoc.relationships.map((row: any) => row.id),
      sender_profile: uoc.senderProfiles.map((row: any) => row.id),
      account: uoc.accounts.map((row: any) => row.id),
    };
    const supplied: SuppliedTriageEvidence = { eventId: context.event.id, factPathsByMessage, contextIds };
    const decision = validateExternalTriageDecision(parsed, supplied);
    const facts = context.members.map((member: any) => member.facts).filter(Boolean) as TriageFacts[];
    const mergedFacts = facts.at(-1);
    if (!mergedFacts) throw new Error(`Triage event '${decision.eventId}' has no extracted facts`);
    const presentation = applyPolicyClamps(decision, mergedFacts).presentation;
    const factsVersion = [...new Set(context.members.map((member: any) => member.factsVersion).filter(Boolean))].sort().join(",");
    return {
      decision,
      facts: mergedFacts,
      factsVersion,
      uocVersion: uoc.version,
      previousDecisionId: context.previousDecision?.id,
      presentation,
    };
  }

  async saveDecisions(
    principal: AuthPrincipal,
    inputs: unknown[],
    options: { source?: "external_agent" | "user_correction"; correctionReason?: string; clientMetadata?: SaveMetadata } = {}
  ) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");
    let prepared: PreparedDecision[];
    try {
      prepared = await Promise.all(inputs.map((input) => this.prepareDecision(principal, input)));
    } catch (error: any) {
      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "TRIAGE_DECISION_REJECTED",
        resourceType: "triage_decision",
        status: "failure",
        details: { reason: error.name ?? "validation_error" },
        errorMessage: error.message,
      });
      throw error;
    }

    const saved = [];
    for (const item of prepared) {
      const id = nanoid();
      const source = options.source ?? "external_agent";
      await db.insert(schema.triageDecisions).values({
        id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        eventId: item.decision.eventId,
        protocolVersion: item.decision.protocolVersion,
        factsVersion: item.factsVersion,
        uocVersion: item.uocVersion,
        judgmentSource: source,
        externalJudgment: item.decision,
        validatedJudgment: item.decision,
        clampsApplied: item.presentation.clampsApplied,
        derivedBand: item.presentation.band,
        derivedUrgency: item.presentation.urgency,
        lane: item.presentation.lane,
        inconsistent: item.presentation.inconsistent,
        safeActionTarget: item.presentation.safeActionTarget,
        reviewFlags: item.presentation.reviewFlags,
        needsReevaluation: false,
        previousDecisionId: item.previousDecisionId ?? null,
        correctionState: source === "user_correction" ? "corrected" : "none",
        correctionReason: options.correctionReason ?? null,
        clientMetadata: options.clientMetadata ?? null,
        createdAt: new Date(),
      });
      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: source === "user_correction" ? "TRIAGE_DECISION_CORRECTED" : "TRIAGE_DECISION_SAVED",
        resourceType: "triage_event",
        resourceId: item.decision.eventId,
        details: { decisionId: id, band: item.presentation.band, clamps: item.presentation.clampsApplied.map((clamp) => clamp.id) },
      });
      saved.push({ decisionId: id, eventId: item.decision.eventId, presentation: item.presentation });
    }
    return { saved };
  }

  async getBriefingCandidates(principal: AuthPrincipal, limit = 20) {
    authService.requireScope(principal, "mail.read");
    const rows = await db.select().from(schema.triageDecisions).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.userId, principal.userId)
    )).orderBy(desc(schema.triageDecisions.createdAt));
    const latest = new Map<string, any>();
    for (const row of rows) if (!latest.has(row.eventId)) latest.set(row.eventId, row);
    return [...latest.values()].filter((row) => row.lane === "briefing" && row.derivedBand !== "noise").slice(0, limit);
  }

  async explain(principal: AuthPrincipal, eventId: string) {
    const context = await this.getEventContext(principal, eventId);
    const decision: any = context.previousDecision;
    return {
      event: context.event,
      factsUsed: context.members.map((member: any) => ({ messageId: member.messageId, facts: member.facts })),
      externalRationale: decision?.validatedJudgment?.rationale ?? null,
      evidence: decision?.validatedJudgment?.evidence ?? [],
      clampsApplied: decision?.clampsApplied ?? [],
      priorityDerivation: decision ? {
        severity: decision.validatedJudgment.consequence.severity,
        timeCriticality: decision.validatedJudgment.timeCriticality,
        harmAccrual: decision.validatedJudgment.harmAccrual,
        status: decision.validatedJudgment.status,
        band: decision.derivedBand,
        lane: decision.lane,
      } : null,
      previousDecisionId: decision?.previousDecisionId ?? null,
    };
  }
}

export const triageService = new TriageService();
