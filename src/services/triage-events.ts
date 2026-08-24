import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { extractFeatures, type TriageFacts } from "@mailwarden/triage-features";
import { deriveEventIdentity } from "@mailwarden/triage-events";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail } from "../types/domain";

export class TriageEventService {
  async recordMessage(principal: AuthPrincipal, email: NormalizedEmail, now = new Date()): Promise<{ eventId: string; facts: TriageFacts }> {
    const facts = extractFeatures(email, now);
    const identity = deriveEventIdentity(email, facts);
    const contentHash = identity.keys.find((key) => key.value.startsWith("content|"))!.value.slice("content|".length);
    const headers = Object.fromEntries(Object.entries(email.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const at = email.receivedAt;

    await db.insert(schema.messageFacts).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      emailId: email.id,
      featureVersion: facts.featureVersion,
      facts,
      contentHash,
      rfcMessageId: headers["message-id"] ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.messageFacts.emailId,
      set: { featureVersion: facts.featureVersion, facts, contentHash, rfcMessageId: headers["message-id"] ?? null, updatedAt: now },
    });

    const [existingMember] = await db.select({ eventId: schema.triageEventMembers.eventId })
      .from(schema.triageEventMembers)
      .where(and(
        eq(schema.triageEventMembers.tenantId, principal.tenantId),
        eq(schema.triageEventMembers.userId, principal.userId),
        eq(schema.triageEventMembers.emailId, email.id)
      ))
      .limit(1);
    if (existingMember) return { eventId: existingMember.eventId, facts };

    const keyValues = identity.keys.map((key) => key.value);
    const matching = await db.select().from(schema.triageEventKeys).where(and(
      eq(schema.triageEventKeys.tenantId, principal.tenantId),
      eq(schema.triageEventKeys.userId, principal.userId),
      inArray(schema.triageEventKeys.value, keyValues)
    ));

    let eventId = matching[0]?.eventId as string | undefined;
    let isNew = false;
    if (eventId) {
      const [matchedEvent] = await db.select({ mergedIntoEventId: schema.triageEvents.mergedIntoEventId })
        .from(schema.triageEvents)
        .where(and(
          eq(schema.triageEvents.id, eventId),
          eq(schema.triageEvents.tenantId, principal.tenantId),
          eq(schema.triageEvents.userId, principal.userId)
        ))
        .limit(1);
      eventId = matchedEvent?.mergedIntoEventId ?? eventId;
    }
    if (!eventId) {
      eventId = nanoid();
      isNew = true;
      await db.insert(schema.triageEvents).values({
        id: eventId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        eventType: identity.eventType,
        eventKey: identity.primaryKey,
        normalizedSubject: identity.normalizedSubject,
        observedState: identity.observedState,
        messageCount: 1,
        firstObservedAt: at,
        lastObservedAt: at,
        createdAt: now,
        updatedAt: now,
      });
    }

    const matchedKind = matching.find((row: any) => row.eventId === eventId)?.kind ?? identity.keys[0]!.kind;
    await db.insert(schema.triageEventMembers).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      eventId,
      emailId: email.id,
      membershipReason: matchedKind,
      supersededByEmailId: null,
      observedAt: at,
      createdAt: now,
    }).onConflictDoNothing({ target: schema.triageEventMembers.emailId });

    for (const key of identity.keys) {
      await db.insert(schema.triageEventKeys).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        eventId,
        kind: key.kind,
        value: key.value,
        createdAt: now,
      }).onConflictDoNothing({ target: [schema.triageEventKeys.tenantId, schema.triageEventKeys.userId, schema.triageEventKeys.value] });
    }

    if (!isNew) {
      await db.update(schema.triageEvents).set({
        messageCount: sql`${schema.triageEvents.messageCount} + 1`,
        lastObservedAt: at,
        observedState: identity.observedState,
        updatedAt: now,
      }).where(and(
        eq(schema.triageEvents.id, eventId),
        eq(schema.triageEvents.tenantId, principal.tenantId),
        eq(schema.triageEvents.userId, principal.userId)
      ));
      await db.update(schema.triageDecisions).set({ needsReevaluation: true }).where(and(
        eq(schema.triageDecisions.eventId, eventId),
        eq(schema.triageDecisions.tenantId, principal.tenantId),
        eq(schema.triageDecisions.userId, principal.userId),
        eq(schema.triageDecisions.needsReevaluation, false)
      ));
    }

    if (identity.observedState === "resolved") {
      await db.update(schema.triageEventMembers).set({ supersededByEmailId: email.id }).where(and(
        eq(schema.triageEventMembers.eventId, eventId),
        ne(schema.triageEventMembers.emailId, email.id)
      ));
    }

    return { eventId, facts };
  }
}

export const triageEventService = new TriageEventService();
