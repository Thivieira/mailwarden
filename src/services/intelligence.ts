import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail } from "../types/domain";
import type {
  DeterministicSignals,
  StoredClassification,
  ImportanceLevel,
  SemanticCategory,
  IntentType,
  WorkflowState,
  TimeSensitivity,
} from "../types/intelligence";
import { relationshipService } from "./relationships";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auditService } from "./audit";

export class IntelligenceService {
  /**
   * Extracts deterministic factual signals from normalized email headers, content, and relationships
   */
  async extractSignals(principal: AuthPrincipal, email: NormalizedEmail): Promise<DeterministicSignals> {
    const fromAddr = email.from.address.toLowerCase();
    const headers = email.headers || {};
    const subject = (email.subject || "").toLowerCase();
    const text = (email.textBody || "").toLowerCase();

    // 1. Relationship context
    const relContext = await relationshipService.getRelationshipContext(principal, fromAddr);
    const knownSender = relContext.senderProfile.messagesSeen > 1;
    const knownRelationship = !!relContext.relationship && relContext.relationship.type !== "unknown";
    const relationshipType = relContext.relationship?.type;
    const userPreviouslyReplied = relContext.senderProfile.repliesFromUser > 0;

    // 2. Newsletter / Bulk / Automated indicators
    const hasListUnsubscribe = Boolean(
      headers["list-unsubscribe"] || headers["list-id"] || email.flags.hasListUnsubscribe
    );
    const bulk = Boolean(
      email.flags.bulk ||
        hasListUnsubscribe ||
        headers["precedence"] === "bulk" ||
        headers["precedence"] === "list" ||
        fromAddr.includes("noreply") ||
        fromAddr.includes("no-reply") ||
        fromAddr.includes("donotreply") ||
        fromAddr.includes("notifications@") ||
        fromAddr.includes("newsletter@")
    );
    const automated = Boolean(
      email.flags.automated ||
        bulk ||
        headers["auto-submitted"] === "auto-generated" ||
        headers["x-autoreply"] === "yes"
    );

    // 3. Security / Financial / Transactional indicators
    const likelySecurityRelated = Boolean(
      subject.includes("security alert") ||
        subject.includes("password reset") ||
        subject.includes("verification code") ||
        subject.includes("2-step verification") ||
        subject.includes("unusual activity") ||
        subject.includes("login attempt") ||
        text.includes("security notice") ||
        text.includes("one-time password") ||
        text.includes("reset your password")
    );

    const likelyFinancial = Boolean(
      subject.includes("invoice") ||
        subject.includes("receipt") ||
        subject.includes("payment due") ||
        subject.includes("wire transfer") ||
        subject.includes("billing statement") ||
        text.includes("invoice #") ||
        text.includes("total amount due") ||
        text.includes("payment confirmation")
    );

    const transactional = Boolean(
      likelyFinancial ||
        subject.includes("order confirmed") ||
        subject.includes("shipping update") ||
        subject.includes("tracking number") ||
        subject.includes("subscription renewed")
    );

    // 4. Client / Recruiter indicators
    const likelyClient = Boolean(
      relationshipType === "client" ||
        (knownRelationship && relContext.relationship?.importanceOverride && relContext.relationship.importanceOverride >= 0.8) ||
        subject.includes("proposal") ||
        subject.includes("scope of work") ||
        subject.includes("deliverable") ||
        subject.includes("contract")
    );

    const likelyRecruiter = Boolean(
      relationshipType === "recruiter" ||
        subject.includes("job opportunity") ||
        subject.includes("interview invitation") ||
        subject.includes("career opportunity") ||
        text.includes("discussing a role") ||
        text.includes("compensation package")
    );

    // 5. Deadline detection
    let explicitDeadline: string | undefined = undefined;
    const deadlineMatch = text.match(/(?:by|before|due on|deadline:?)\s+([A-Za-z]+,?\s+[0-9]{1,2}(?:st|nd|rd|th)?|[0-9]{1,2}\/[0-9]{1,2}(?:\/[0-9]{2,4})?|tomorrow|eod|end of day|friday|monday|tuesday|wednesday|thursday)/i);
    if (deadlineMatch && deadlineMatch[1]) {
      explicitDeadline = deadlineMatch[1].trim();
    }

    const ruleHits: string[] = [];
    if (knownRelationship) ruleHits.push(`relationship:${relationshipType}`);
    if (likelyClient) ruleHits.push("signal:likely_client");
    if (likelyRecruiter) ruleHits.push("signal:likely_recruiter");
    if (likelySecurityRelated) ruleHits.push("signal:security_alert");
    if (likelyFinancial) ruleHits.push("signal:financial_notice");
    if (explicitDeadline) ruleHits.push(`deadline:${explicitDeadline}`);
    if (hasListUnsubscribe) ruleHits.push("header:list_unsubscribe");
    if (bulk) ruleHits.push("flag:bulk");
    if (automated) ruleHits.push("flag:automated");
    if (userPreviouslyReplied) ruleHits.push("history:user_previously_replied");

    return {
      knownSender,
      knownRelationship,
      relationshipType,
      activeThread: Boolean(email.providerThreadId),
      userPreviouslyReplied,
      bulk,
      newsletter: hasListUnsubscribe,
      automated,
      transactional,
      likelyClient,
      likelyRecruiter,
      likelyFinancial,
      likelySecurityRelated,
      explicitDeadline,
      hasListUnsubscribe,
      ruleHits,
    };
  }

  /**
   * Generates or retrieves stored classification for an email.
   * Uses factual signals and user corrections if available.
   */
  async classifyEmail(
    principal: AuthPrincipal,
    email: NormalizedEmail,
    signals: DeterministicSignals
  ): Promise<StoredClassification> {
    // Check if existing classification exists
    const [existing] = await db
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

    if (existing) {
      return {
        id: existing.id,
        tenantId: existing.tenantId,
        userId: existing.userId,
        emailId: existing.emailId,
        threadId: existing.threadId || undefined,
        importance: existing.importance as ImportanceLevel,
        category: existing.category as SemanticCategory,
        intent: existing.intent as IntentType,
        workflowState: existing.workflowState as WorkflowState,
        timeSensitivity: existing.timeSensitivity as TimeSensitivity,
        summary: existing.summary,
        reason: existing.reason,
        confidence: existing.confidence / 100,
        deadline: existing.deadline || undefined,
        entities: existing.entities || undefined,
        source: existing.source as any,
        modelOrClient: existing.modelOrClient || undefined,
        userCorrected: Boolean(existing.userCorrected),
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    // Derive deterministic baseline classification
    let importance: ImportanceLevel = "normal";
    let category: SemanticCategory = "other";
    let intent: IntentType = "informing";
    let workflowState: WorkflowState = "fyi";
    let timeSensitivity: TimeSensitivity = "none";
    let reason = "Standard incoming message";

    if (signals.likelySecurityRelated) {
      importance = "critical";
      category = "security";
      intent = "notifying";
      workflowState = "action_required";
      timeSensitivity = "immediate";
      reason = "Security verification or urgent account alert";
    } else if (signals.likelyClient) {
      importance = "high";
      category = "client";
      intent = "requesting_action";
      workflowState = "action_required";
      timeSensitivity = signals.explicitDeadline ? "today" : "soon";
      reason = `Important communication from client (${signals.relationshipType || "identified client"})`;
    } else if (signals.likelyRecruiter) {
      importance = "high";
      category = "recruiter";
      intent = "informing";
      workflowState = "action_required";
      timeSensitivity = "soon";
      reason = "Career / recruiter opportunity";
    } else if (signals.likelyFinancial) {
      importance = "high";
      category = "financial";
      intent = "confirming";
      workflowState = "action_required";
      timeSensitivity = "soon";
      reason = "Financial invoice or billing document";
    } else if (signals.bulk || signals.newsletter) {
      importance = "low";
      category = "newsletter";
      intent = "informing";
      workflowState = "news";
      timeSensitivity = "none";
      reason = "Automated newsletter or broadcast message";
    } else if (signals.userPreviouslyReplied) {
      importance = "high";
      category = "work";
      intent = "asking_question";
      workflowState = "action_required";
      timeSensitivity = "soon";
      reason = "Ongoing conversation with prior user replies";
    }

    const summary = email.snippet || email.subject || "No message content preview";
    const now = new Date();
    const id = nanoid();

    await db.insert(schema.classifications).values({
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      emailId: email.id,
      threadId: email.providerThreadId || null,
      importance,
      category,
      intent,
      workflowState,
      timeSensitivity,
      summary,
      reason,
      confidence: 85,
      deadline: signals.explicitDeadline || null,
      source: "deterministic_rules",
      userCorrected: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      emailId: email.id,
      threadId: email.providerThreadId,
      importance,
      category,
      intent,
      workflowState,
      timeSensitivity,
      summary,
      reason,
      confidence: 0.85,
      deadline: signals.explicitDeadline,
      source: "deterministic_rules",
      userCorrected: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Persists an explicit user or MCP client correction to a classification
   */
  async correctClassification(
    principal: AuthPrincipal,
    params: {
      emailId: string;
      importance?: ImportanceLevel;
      category?: SemanticCategory;
      intent?: IntentType;
      workflowState?: WorkflowState;
      timeSensitivity?: TimeSensitivity;
      summary?: string;
      reason?: string;
    }
  ): Promise<StoredClassification> {
    const [existing] = await db
      .select()
      .from(schema.classifications)
      .where(
        and(
          eq(schema.classifications.tenantId, principal.tenantId),
          eq(schema.classifications.userId, principal.userId),
          eq(schema.classifications.emailId, params.emailId)
        )
      )
      .limit(1);

    const now = new Date();
    let classId = existing?.id;

    if (existing) {
      await db
        .update(schema.classifications)
        .set({
          importance: params.importance || existing.importance,
          category: params.category || existing.category,
          intent: params.intent || existing.intent,
          workflowState: params.workflowState || existing.workflowState,
          timeSensitivity: params.timeSensitivity || existing.timeSensitivity,
          summary: params.summary || existing.summary,
          reason: params.reason || `User corrected: ${params.reason || "Manual update"}`,
          confidence: 100,
          source: "user_correction",
          userCorrected: true,
          updatedAt: now,
        })
        .where(eq(schema.classifications.id, existing.id));
    } else {
      classId = nanoid();
      await db.insert(schema.classifications).values({
        id: classId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        emailId: params.emailId,
        importance: params.importance || "normal",
        category: params.category || "other",
        intent: params.intent || "informing",
        workflowState: params.workflowState || "fyi",
        timeSensitivity: params.timeSensitivity || "none",
        summary: params.summary || "Corrected message classification",
        reason: params.reason || "Explicit user correction",
        confidence: 100,
        source: "user_correction",
        userCorrected: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "CLASSIFICATION_CORRECTION",
      resourceType: "classification",
      resourceId: classId,
      details: { emailId: params.emailId, updates: params },
    });

    const [updated] = await db
      .select()
      .from(schema.classifications)
      .where(eq(schema.classifications.id, classId!))
      .limit(1);

    return {
      id: updated!.id,
      tenantId: updated!.tenantId,
      userId: updated!.userId,
      emailId: updated!.emailId,
      threadId: updated!.threadId || undefined,
      importance: updated!.importance as ImportanceLevel,
      category: updated!.category as SemanticCategory,
      intent: updated!.intent as IntentType,
      workflowState: updated!.workflowState as WorkflowState,
      timeSensitivity: updated!.timeSensitivity as TimeSensitivity,
      summary: updated!.summary,
      reason: updated!.reason,
      confidence: updated!.confidence / 100,
      source: updated!.source as any,
      userCorrected: Boolean(updated!.userCorrected),
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  }
}

export const intelligenceService = new IntelligenceService();
