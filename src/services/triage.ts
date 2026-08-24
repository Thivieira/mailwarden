import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
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
import { ValidationError } from "../utils/errors";

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
  previousDecisionAt?: Date;
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
    const [organizations, projects, relationships, senderProfiles, accounts, services, commitments, preferences] = await Promise.all([
      db.select().from(schema.organizations).where(owned(schema.organizations)),
      db.select().from(schema.projects).where(owned(schema.projects)),
      db.select().from(schema.relationships).where(owned(schema.relationships)),
      db.select().from(schema.senderProfiles).where(owned(schema.senderProfiles)),
      db.select().from(schema.emailAccounts).where(owned(schema.emailAccounts)),
      db.select().from(schema.userServices).where(owned(schema.userServices)),
      db.select().from(schema.userCommitments).where(owned(schema.userCommitments)),
      db.select().from(schema.userPreferences).where(owned(schema.userPreferences)).limit(1),
    ]);
    const context = {
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
      services,
      commitments,
      preferences: preferences[0] ? {
        id: preferences[0].id,
        preferredLanguage: preferences[0].preferredLanguage,
        selectedPreset: preferences[0].selectedPreset,
        customSettings: preferences[0].customSettings,
      } : null,
    };
    const version = createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 16);
    return { version, ...context };
  }

  private async markUocChanged(principal: AuthPrincipal) {
    await db.update(schema.triageDecisions).set({ needsReevaluation: true }).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.userId, principal.userId),
      eq(schema.triageDecisions.needsReevaluation, false)
    ));
  }

  async setUserService(principal: AuthPrincipal, input: {
    id?: string;
    name: string;
    provider?: string;
    environment: "production" | "staging" | "development" | "other";
    status?: "active" | "inactive";
    domains?: string[];
    accountIds?: string[];
    notes?: string;
  }) {
    authService.requireScope(principal, "profile.manage");
    const accountIds = [...new Set(input.accountIds ?? [])];
    if (accountIds.length) {
      const ownedAccounts = await db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts).where(and(
        eq(schema.emailAccounts.tenantId, principal.tenantId),
        eq(schema.emailAccounts.userId, principal.userId),
        inArray(schema.emailAccounts.id, accountIds)
      ));
      if (ownedAccounts.length !== accountIds.length) throw new Error("One or more account IDs are unknown or unauthorized");
    }
    const normalized = {
      name: input.name.trim(),
      provider: input.provider?.trim() || null,
      environment: input.environment,
      status: input.status ?? "active" as const,
      domains: [...new Set((input.domains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean))],
      accountIds,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    };
    const [existing] = await db.select().from(schema.userServices).where(and(
      eq(schema.userServices.tenantId, principal.tenantId),
      eq(schema.userServices.userId, principal.userId),
      input.id ? eq(schema.userServices.id, input.id) : eq(schema.userServices.name, normalized.name)
    )).limit(1);
    const id = existing?.id ?? nanoid();
    if (existing) await db.update(schema.userServices).set(normalized).where(eq(schema.userServices.id, id));
    else await db.insert(schema.userServices).values({ id, tenantId: principal.tenantId, userId: principal.userId, ...normalized, createdAt: normalized.updatedAt });
    await this.markUocChanged(principal);
    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "UOC_SERVICE_UPDATE",
      resourceType: "user_service",
      resourceId: id,
      details: { name: normalized.name, environment: normalized.environment, status: normalized.status },
    });
    return (await db.select().from(schema.userServices).where(eq(schema.userServices.id, id)).limit(1))[0];
  }

  async setUserCommitment(principal: AuthPrincipal, input: {
    id?: string;
    kind: "subscription" | "payment" | "deadline" | "contract" | "other";
    name: string;
    counterparty?: string;
    amountMinor?: number;
    currency?: string;
    dueAt?: string;
    status?: "active" | "fulfilled" | "cancelled";
    relatedServiceId?: string;
    notes?: string;
  }) {
    authService.requireScope(principal, "profile.manage");
    if (input.relatedServiceId) {
      const [service] = await db.select({ id: schema.userServices.id }).from(schema.userServices).where(and(
        eq(schema.userServices.id, input.relatedServiceId),
        eq(schema.userServices.tenantId, principal.tenantId),
        eq(schema.userServices.userId, principal.userId)
      )).limit(1);
      if (!service) throw new Error("Related service is unknown or unauthorized");
    }
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && !Number.isFinite(dueAt.getTime())) throw new Error("Invalid commitment dueAt");
    const normalized = {
      kind: input.kind,
      name: input.name.trim(),
      counterparty: input.counterparty?.trim() || null,
      amountMinor: input.amountMinor ?? null,
      currency: input.currency?.trim().toUpperCase() || null,
      dueAt,
      status: input.status ?? "active" as const,
      relatedServiceId: input.relatedServiceId ?? null,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    };
    let existing: any;
    if (input.id) [existing] = await db.select().from(schema.userCommitments).where(and(
      eq(schema.userCommitments.id, input.id),
      eq(schema.userCommitments.tenantId, principal.tenantId),
      eq(schema.userCommitments.userId, principal.userId)
    )).limit(1);
    const id = existing?.id ?? nanoid();
    if (existing) await db.update(schema.userCommitments).set(normalized).where(eq(schema.userCommitments.id, id));
    else await db.insert(schema.userCommitments).values({ id, tenantId: principal.tenantId, userId: principal.userId, ...normalized, createdAt: normalized.updatedAt });
    await this.markUocChanged(principal);
    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "UOC_COMMITMENT_UPDATE",
      resourceType: "user_commitment",
      resourceId: id,
      details: { kind: normalized.kind, name: normalized.name, status: normalized.status },
    });
    return (await db.select().from(schema.userCommitments).where(eq(schema.userCommitments.id, id)).limit(1))[0];
  }

  async getEventContext(principal: AuthPrincipal, eventId: string, includeBody = false) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "mail.read");
    const [requestedEvent] = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.id, eventId),
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    )).limit(1);
    if (!requestedEvent) throw new Error(`Triage event '${eventId}' not found`);
    const canonicalId = requestedEvent.mergedIntoEventId ?? requestedEvent.id;
    const [canonicalEvent] = canonicalId === requestedEvent.id ? [requestedEvent] : await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.id, canonicalId),
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    )).limit(1);
    if (!canonicalEvent) throw new Error(`Canonical triage event '${canonicalId}' not found`);
    const aliases = await db.select({ id: schema.triageEvents.id }).from(schema.triageEvents).where(and(
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId),
      eq(schema.triageEvents.mergedIntoEventId, canonicalId)
    ));
    const eventIds = [canonicalId, ...aliases.map((row: any) => row.id)];

    const members = await db.select().from(schema.triageEventMembers).where(and(
      inArray(schema.triageEventMembers.eventId, eventIds),
      eq(schema.triageEventMembers.tenantId, principal.tenantId),
      eq(schema.triageEventMembers.userId, principal.userId)
    )).orderBy(asc(schema.triageEventMembers.observedAt));
    const ids = members.map((member: any) => member.emailId);
    const [messages, factsRows, previous] = await Promise.all([
      ids.length ? db.select().from(schema.emails).where(inArray(schema.emails.id, ids)) : [],
      ids.length ? db.select().from(schema.messageFacts).where(inArray(schema.messageFacts.emailId, ids)) : [],
      db.select().from(schema.triageDecisions).where(and(
        eq(schema.triageDecisions.eventId, canonicalId),
        eq(schema.triageDecisions.tenantId, principal.tenantId),
        eq(schema.triageDecisions.userId, principal.userId)
      )).orderBy(desc(schema.triageDecisions.createdAt)).limit(1),
    ]);
    const messageById = new Map(messages.map((message: any) => [message.id, message]));
    const factsById = new Map(factsRows.map((row: any) => [row.emailId, row]));

    return {
      requestedEventId: eventId,
      event: {
        ...canonicalEvent,
        messageCount: members.length,
        firstObservedAt: members[0]?.observedAt ?? canonicalEvent.firstObservedAt,
        lastObservedAt: members.at(-1)?.observedAt ?? canonicalEvent.lastObservedAt,
        mergedEventIds: aliases.map((row: any) => row.id),
      },
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
      eq(schema.triageEvents.userId, principal.userId),
      isNull(schema.triageEvents.mergedIntoEventId)
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
          ? { messageCount: context.event.messageCount, needsReevaluation: Boolean(context.previousDecision.needsReevaluation) }
          : { firstJudgment: true, messageCount: context.event.messageCount },
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
      service: uoc.services.map((row: any) => row.id),
      commitment: uoc.commitments.map((row: any) => row.id),
      preference: uoc.preferences ? [uoc.preferences.id] : [],
    };
    const supplied: SuppliedTriageEvidence = { eventId: context.event.id, factPathsByMessage, contextIds };
    const decision = validateExternalTriageDecision(parsed, supplied);
    const facts = context.members.map((member: any) => member.facts).filter(Boolean) as TriageFacts[];
    const latestFacts = facts.at(-1);
    const mergedFacts = latestFacts ? {
      ...latestFacts,
      amounts: facts.flatMap((item) => item.amounts),
      entityIds: facts.flatMap((item) => item.entityIds),
      deadlines: facts.flatMap((item) => item.deadlines),
      credentials: facts.flatMap((item) => item.credentials),
      errors: facts.flatMap((item) => item.errors),
      paymentEvents: facts.flatMap((item) => item.paymentEvents),
      securityEvents: facts.flatMap((item) => item.securityEvents),
      infrastructureEvents: facts.flatMap((item) => item.infrastructureEvents),
    } : undefined;
    if (!mergedFacts) throw new Error(`Triage event '${decision.eventId}' has no extracted facts`);
    const presentation = applyPolicyClamps(decision, mergedFacts, { observedState: context.event.observedState }).presentation;
    const factsVersion = [...new Set(context.members.map((member: any) => member.factsVersion).filter(Boolean))].sort().join(",");
    return {
      decision,
      facts: mergedFacts,
      factsVersion,
      uocVersion: uoc.version,
      previousDecisionId: context.previousDecision?.id,
      previousDecisionAt: context.previousDecision?.createdAt,
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
      const createdAt = new Date(Math.max(Date.now(), (item.previousDecisionAt?.getTime() ?? 0) + 1));
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
        createdAt,
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
    const [previous, uoc, eventChanges] = await Promise.all([
      decision?.previousDecisionId
        ? db.select().from(schema.triageDecisions).where(and(
          eq(schema.triageDecisions.id, decision.previousDecisionId),
          eq(schema.triageDecisions.tenantId, principal.tenantId),
          eq(schema.triageDecisions.userId, principal.userId)
        )).limit(1).then((rows: any[]) => rows[0] ?? null)
        : null,
      this.getUserOperatingContext(principal),
      db.select().from(schema.triageEventChanges).where(and(
        eq(schema.triageEventChanges.tenantId, principal.tenantId),
        eq(schema.triageEventChanges.userId, principal.userId),
        or(
          eq(schema.triageEventChanges.sourceEventId, context.event.id),
          eq(schema.triageEventChanges.targetEventId, context.event.id)
        )
      )).orderBy(desc(schema.triageEventChanges.createdAt)),
    ]);
    const currentJudgment: any = decision?.validatedJudgment;
    const previousJudgment: any = previous?.validatedJudgment;
    const paths = ["domain", "status", "consequence.severity", "timeCriticality", "harmAccrual", "actionRequired", "actor", "waitingOn", "action.kind", "briefing.include"];
    const get = (value: any, path: string) => path.split(".").reduce((item, part) => item?.[part], value);
    const whatChanged = previous ? [
      ...paths.flatMap((path) => get(previousJudgment, path) === get(currentJudgment, path) ? [] : [{ field: path, from: get(previousJudgment, path), to: get(currentJudgment, path) }]),
      ...(["derivedBand", "derivedUrgency", "lane"] as const).flatMap((field) => previous[field] === decision[field] ? [] : [{ field: `presentation.${field}`, from: previous[field], to: decision[field] }]),
    ] : [];
    const contextRows = new Map<string, any>();
    for (const [kind, rows] of [
      ["organization", uoc.organizations], ["project", uoc.projects], ["relationship", uoc.relationships],
      ["sender_profile", uoc.senderProfiles], ["account", uoc.accounts], ["service", uoc.services],
      ["commitment", uoc.commitments], ["preference", uoc.preferences ? [uoc.preferences] : []],
    ] as const) for (const row of rows as any[]) contextRows.set(`${kind}:${row.id}`, row);
    return {
      event: context.event,
      factsUsed: context.members.map((member: any) => ({ messageId: member.messageId, facts: member.facts })),
      externalRationale: decision?.validatedJudgment?.rationale ?? null,
      evidence: decision?.validatedJudgment?.evidence ?? [],
      userContextUsed: (currentJudgment?.contextReferences ?? []).map((reference: any) => ({
        ...reference,
        record: contextRows.get(`${reference.kind}:${reference.id}`) ?? null,
      })),
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
      previousJudgment: previousJudgment ?? null,
      whatChanged,
      eventChanges,
    };
  }

  private correctionReason(reason: string) {
    const value = reason.trim();
    if (!value || value.length > 500) throw new ValidationError("reason must contain 1 to 500 characters");
    return value;
  }

  async mergeEvents(principal: AuthPrincipal, sourceEventId: string, targetEventId: string, reason: string) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");
    if (sourceEventId === targetEventId) throw new ValidationError("source and target events must differ");
    const events = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId),
      inArray(schema.triageEvents.id, [sourceEventId, targetEventId])
    ));
    const source = events.find((row: any) => row.id === sourceEventId);
    const target = events.find((row: any) => row.id === targetEventId);
    if (!source || !target) throw new ValidationError("One or more event IDs are unknown or unauthorized");
    if (source.mergedIntoEventId || target.mergedIntoEventId) throw new ValidationError("Merge only canonical events");
    // ponytail: one-level merge graph; unmerge child events before merging their parent if nested correction is ever needed.
    const [child] = await db.select({ id: schema.triageEvents.id }).from(schema.triageEvents).where(and(
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId),
      eq(schema.triageEvents.mergedIntoEventId, sourceEventId)
    )).limit(1);
    if (child) throw new ValidationError("Source event already contains merged events; unmerge them first");
    const normalizedReason = this.correctionReason(reason);
    const now = new Date();
    await db.update(schema.triageEvents).set({ mergedIntoEventId: targetEventId, updatedAt: now }).where(eq(schema.triageEvents.id, sourceEventId));
    await db.update(schema.triageDecisions).set({ needsReevaluation: true }).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.userId, principal.userId),
      inArray(schema.triageDecisions.eventId, [sourceEventId, targetEventId])
    ));
    const id = nanoid();
    await db.insert(schema.triageEventChanges).values({ id, tenantId: principal.tenantId, userId: principal.userId, action: "merge", sourceEventId, targetEventId, reason: normalizedReason, createdAt: now });
    await auditService.logEvent({ tenantId: principal.tenantId, userId: principal.userId, action: "TRIAGE_EVENTS_MERGED", resourceType: "triage_event", resourceId: targetEventId, details: { sourceEventId, changeId: id } });
    return { changeId: id, sourceEventId, targetEventId, canonicalEventId: targetEventId };
  }

  async unmergeEvent(principal: AuthPrincipal, sourceEventId: string, reason: string) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");
    const [source] = await db.select().from(schema.triageEvents).where(and(
      eq(schema.triageEvents.id, sourceEventId),
      eq(schema.triageEvents.tenantId, principal.tenantId),
      eq(schema.triageEvents.userId, principal.userId)
    )).limit(1);
    if (!source) throw new ValidationError("Event ID is unknown or unauthorized");
    if (!source.mergedIntoEventId) throw new ValidationError("Event is not merged");
    const targetEventId = source.mergedIntoEventId;
    const normalizedReason = this.correctionReason(reason);
    const now = new Date();
    await db.update(schema.triageEvents).set({ mergedIntoEventId: null, updatedAt: now }).where(eq(schema.triageEvents.id, sourceEventId));
    await db.update(schema.triageDecisions).set({ needsReevaluation: true }).where(and(
      eq(schema.triageDecisions.tenantId, principal.tenantId),
      eq(schema.triageDecisions.userId, principal.userId),
      inArray(schema.triageDecisions.eventId, [sourceEventId, targetEventId])
    ));
    const id = nanoid();
    await db.insert(schema.triageEventChanges).values({ id, tenantId: principal.tenantId, userId: principal.userId, action: "unmerge", sourceEventId, targetEventId, reason: normalizedReason, createdAt: now });
    await auditService.logEvent({ tenantId: principal.tenantId, userId: principal.userId, action: "TRIAGE_EVENTS_UNMERGED", resourceType: "triage_event", resourceId: sourceEventId, details: { targetEventId, changeId: id } });
    return { changeId: id, sourceEventId, previousTargetEventId: targetEventId, canonicalEventId: sourceEventId };
  }
}

export const triageService = new TriageService();
