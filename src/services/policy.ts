import { db, schema } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail } from "../types/domain";
import type { StoredClassification, DeterministicSignals } from "../types/intelligence";
import type {
  MailPolicy,
  PolicyPresetName,
  PolicyScope,
  PolicyAction,
  UserLevelClassification,
  PolicyEvaluationResult,
  PolicySuggestion,
} from "../types/policy";
import { authService } from "./auth";
import { auditService } from "./audit";
import { relationshipService } from "./relationships";
import { config } from "../config";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger";
import { ValidationError } from "../utils/errors";

export class PolicyService {
  /**
   * Initializes or resets policies for a user to a selected preset
   */
  async applyPreset(
    principal: AuthPrincipal,
    preset: PolicyPresetName
  ): Promise<MailPolicy[]> {
    authService.requirePrincipal(principal);

    // Remove existing system preset policies for this user
    await db
      .delete(schema.mailPolicies)
      .where(
        and(
          eq(schema.mailPolicies.tenantId, principal.tenantId),
          eq(schema.mailPolicies.userId, principal.userId),
          eq(schema.mailPolicies.isSystemPreset, true)
        )
      );

    const now = new Date();
    const presetPolicies: Array<Omit<MailPolicy, "id" | "tenantId" | "userId" | "createdAt" | "updatedAt">> = [];

    if (preset === "safe") {
      presetPolicies.push(
        {
          name: "Safe: Preserve Junk",
          scope: "classification",
          targetType: "classification",
          targetValue: "junk",
          classification: "junk",
          action: "leave",
          minimumConfidence: 90,
          priority: 50,
          isSystemPreset: true,
          presetName: "safe",
          enabled: true,
          userPrompt: "Keep all junk email in the inbox without moving",
        },
        {
          name: "Safe: Routine in Inbox",
          scope: "classification",
          targetType: "classification",
          targetValue: "routine",
          classification: "routine",
          action: "leave",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "safe",
          enabled: true,
        },
        {
          name: "Safe: Interesting Visible",
          scope: "classification",
          targetType: "classification",
          targetValue: "interesting",
          classification: "interesting",
          action: "leave",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "safe",
          enabled: true,
        },
        {
          name: "Safe: Important Visible",
          scope: "classification",
          targetType: "classification",
          targetValue: "important",
          classification: "important",
          action: "keep_unread",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "safe",
          enabled: true,
        },
        {
          name: "Safe: Critical Surface",
          scope: "classification",
          targetType: "classification",
          targetValue: "critical",
          classification: "critical",
          action: "surface",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "safe",
          enabled: true,
        }
      );
    } else if (preset === "inbox_zero") {
      presetPolicies.push(
        {
          name: "Inbox Zero: Archive Junk",
          scope: "classification",
          targetType: "classification",
          targetValue: "junk",
          classification: "junk",
          action: "archive",
          minimumConfidence: 75,
          priority: 50,
          isSystemPreset: true,
          presetName: "inbox_zero",
          enabled: true,
          userPrompt: "Archive junk email automatically",
        },
        {
          name: "Inbox Zero: Archive Routine",
          scope: "classification",
          targetType: "classification",
          targetValue: "routine",
          classification: "routine",
          action: "archive",
          minimumConfidence: 75,
          priority: 50,
          isSystemPreset: true,
          presetName: "inbox_zero",
          enabled: true,
          userPrompt: "Archive routine broadcast and automated mail",
        },
        {
          name: "Inbox Zero: Label Interesting",
          scope: "classification",
          targetType: "classification",
          targetValue: "interesting",
          classification: "interesting",
          action: "label",
          destination: "Interesting",
          minimumConfidence: 75,
          priority: 50,
          isSystemPreset: true,
          presetName: "inbox_zero",
          enabled: true,
        },
        {
          name: "Inbox Zero: Keep Important in Inbox",
          scope: "classification",
          targetType: "classification",
          targetValue: "important",
          classification: "important",
          action: "keep_unread",
          minimumConfidence: 75,
          priority: 50,
          isSystemPreset: true,
          presetName: "inbox_zero",
          enabled: true,
        },
        {
          name: "Inbox Zero: Surface Critical",
          scope: "classification",
          targetType: "classification",
          targetValue: "critical",
          classification: "critical",
          action: "surface",
          minimumConfidence: 75,
          priority: 50,
          isSystemPreset: true,
          presetName: "inbox_zero",
          enabled: true,
        }
      );
    } else {
      // Balanced (Recommended default)
      presetPolicies.push(
        {
          name: "Balanced: Archive Obvious Junk",
          scope: "classification",
          targetType: "classification",
          targetValue: "junk",
          classification: "junk",
          action: "archive",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "balanced",
          enabled: true,
          userPrompt: "Archive junk and automated marketing emails automatically",
        },
        {
          name: "Balanced: Keep Routine in Inbox",
          scope: "classification",
          targetType: "classification",
          targetValue: "routine",
          classification: "routine",
          action: "leave",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "balanced",
          enabled: true,
        },
        {
          name: "Balanced: Keep Interesting Visible",
          scope: "classification",
          targetType: "classification",
          targetValue: "interesting",
          classification: "interesting",
          action: "leave",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "balanced",
          enabled: true,
        },
        {
          name: "Balanced: Prioritize Important",
          scope: "classification",
          targetType: "classification",
          targetValue: "important",
          classification: "important",
          action: "keep_unread",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "balanced",
          enabled: true,
        },
        {
          name: "Balanced: Surface Critical",
          scope: "classification",
          targetType: "classification",
          targetValue: "critical",
          classification: "critical",
          action: "surface",
          minimumConfidence: 80,
          priority: 50,
          isSystemPreset: true,
          presetName: "balanced",
          enabled: true,
        }
      );
    }

    for (const p of presetPolicies) {
      await db.insert(schema.mailPolicies).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        ...p,
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PRESET_POLICIES_APPLIED",
      resourceType: "mail_policies",
      details: { preset, count: presetPolicies.length },
    });

    return this.getUserPolicies(principal);
  }

  /**
   * Retrieves all active policies for a user
   */
  async getUserPolicies(principal: AuthPrincipal): Promise<MailPolicy[]> {
    authService.requirePrincipal(principal);

    const rows = await db
      .select()
      .from(schema.mailPolicies)
      .where(
        and(
          eq(schema.mailPolicies.tenantId, principal.tenantId),
          eq(schema.mailPolicies.userId, principal.userId)
        )
      )
      .orderBy(desc(schema.mailPolicies.priority), desc(schema.mailPolicies.createdAt));

    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      name: r.name,
      scope: r.scope as PolicyScope,
      targetType: r.targetType,
      targetValue: r.targetValue || undefined,
      classification: r.classification || undefined,
      action: r.action as PolicyAction,
      destination: r.destination || undefined,
      minimumConfidence: r.minimumConfidence,
      priority: r.priority,
      isSystemPreset: Boolean(r.isSystemPreset),
      presetName: r.presetName || undefined,
      enabled: Boolean(r.enabled),
      userPrompt: r.userPrompt || undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Adds or updates a persistent policy
   */
  async setPolicy(
    principal: AuthPrincipal,
    policyInput: {
      id?: string;
      name: string;
      scope: PolicyScope;
      targetId?: string;
      targetValue?: string;
      classification?: UserLevelClassification | "any";
      action: PolicyAction;
      destination?: string;
      minimumConfidence?: number;
      priority?: number;
      enabled?: boolean;
      userPrompt?: string;
    }
  ): Promise<MailPolicy> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");

    // Map targetId to targetValue if provided
    const targetValue = policyInput.targetValue || policyInput.targetId;

    // Security invariant: never allow autonomous permanent deletion bypass
    if (policyInput.action === "delete") {
      logger.warn(`User configured deletion policy for target=${targetValue}`);
    }

    const now = new Date();
    const id = policyInput.id || nanoid();

    const priority =
      policyInput.priority ??
      (policyInput.scope === "message"
        ? 100
        : policyInput.scope === "sender"
        ? 80
        : policyInput.scope === "relationship"
        ? 70
        : 60);

    const [existing] = policyInput.id
      ? await db
          .select()
          .from(schema.mailPolicies)
          .where(
            and(
              eq(schema.mailPolicies.id, policyInput.id),
              eq(schema.mailPolicies.tenantId, principal.tenantId),
              eq(schema.mailPolicies.userId, principal.userId)
            )
          )
          .limit(1)
      : [];

    if (existing) {
      await db
        .update(schema.mailPolicies)
        .set({
          name: policyInput.name,
          scope: policyInput.scope,
          targetType: policyInput.scope,
          targetValue: targetValue || null,
          classification: policyInput.classification || null,
          action: policyInput.action,
          destination: policyInput.destination || null,
          minimumConfidence: policyInput.minimumConfidence ?? existing.minimumConfidence,
          priority,
          enabled: policyInput.enabled ?? true,
          userPrompt: policyInput.userPrompt || existing.userPrompt || null,
          isSystemPreset: false, // Explicit user customization
          updatedAt: now,
        })
        .where(eq(schema.mailPolicies.id, existing.id));
    } else {
      await db.insert(schema.mailPolicies).values({
        id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        name: policyInput.name,
        scope: policyInput.scope,
        targetType: policyInput.scope,
        targetValue: targetValue || null,
        classification: policyInput.classification || null,
        action: policyInput.action,
        destination: policyInput.destination || null,
        minimumConfidence: policyInput.minimumConfidence ?? 80,
        priority,
        isSystemPreset: false,
        enabled: policyInput.enabled ?? true,
        userPrompt: policyInput.userPrompt || null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "POLICY_CREATE_OR_UPDATE",
      resourceType: "mail_policy",
      resourceId: id,
      details: {
        ...policyInput,
        targetValue,
      },
    });

    const [saved] = await db
      .select()
      .from(schema.mailPolicies)
      .where(eq(schema.mailPolicies.id, id))
      .limit(1);

    return {
      id: saved!.id,
      tenantId: saved!.tenantId,
      userId: saved!.userId,
      name: saved!.name,
      scope: saved!.scope as PolicyScope,
      targetType: saved!.targetType,
      targetValue: saved!.targetValue || undefined,
      targetId: saved!.targetValue || undefined,
      classification: saved!.classification || undefined,
      action: saved!.action as PolicyAction,
      destination: saved!.destination || undefined,
      minimumConfidence: saved!.minimumConfidence,
      priority: saved!.priority,
      isSystemPreset: Boolean(saved!.isSystemPreset),
      presetName: saved!.presetName || undefined,
      enabled: Boolean(saved!.enabled),
      userPrompt: saved!.userPrompt || undefined,
      createdAt: saved!.createdAt,
      updatedAt: saved!.updatedAt,
    };
  }

  /**
   * Removes a policy by ID
   */
  async removePolicy(principal: AuthPrincipal, policyId: string): Promise<boolean> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");

    const result = await db
      .delete(schema.mailPolicies)
      .where(
        and(
          eq(schema.mailPolicies.id, policyId),
          eq(schema.mailPolicies.tenantId, principal.tenantId),
          eq(schema.mailPolicies.userId, principal.userId)
        )
      );

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "POLICY_DELETED",
      resourceType: "mail_policy",
      resourceId: policyId,
    });

    return true;
  }

  /**
   * Translates internal semantic classification into user-facing classification
   */
  mapSemanticToUserLevel(
    classification: StoredClassification,
    signals?: DeterministicSignals
  ): UserLevelClassification {
    // Critical priority or security alerts -> Critical
    if (classification.importance === "critical" || classification.category === "security") {
      return "critical";
    }

    // High importance, client, or action required -> Important
    if (
      classification.importance === "high" ||
      classification.category === "client" ||
      classification.category === "recruiter" ||
      classification.category === "financial"
    ) {
      return "important";
    }

    // Low importance, bulk newsletters, or automated junk -> Junk
    if (
      classification.importance === "low" ||
      classification.category === "junk" ||
      classification.workflowState === "junk" ||
      (signals?.bulk && signals?.hasListUnsubscribe && !signals?.userPreviouslyReplied)
    ) {
      return "junk";
    }

    // Content of potential interest (newsletters the user reads, or interesting category)
    if (classification.category === "newsletter" && signals?.userPreviouslyReplied) {
      return "interesting";
    }

    // Default -> Routine
    return "routine";
  }

  /**
   * Evaluates user email against active policies using strict deterministic precedence:
   * 1. Explicit message override (700) / thread override (600)
   * 2. Explicit sender rule (500) / domain rule (450)
   * 3. Relationship rule (400)
   * 4. Project (250) / organization rule (300)
   * 5. Account rule (200)
   * 6. User classification policy (150) / preset policy (100)
   * 7. Global default fallback (10)
   */
  async evaluatePolicies(
    principal: AuthPrincipal,
    email: NormalizedEmail,
    classification?: StoredClassification,
    signals?: DeterministicSignals
  ): Promise<PolicyEvaluationResult> {
    authService.requirePrincipal(principal);

    const fromAddr = email.from.address.toLowerCase().trim();
    const domain = fromAddr.includes("@") ? fromAddr.split("@")[1] : "";

    // Fetch all active policies for the user
    let policies = await this.getUserPolicies(principal);
    policies = policies.filter((p) => p.enabled);

    // If user has no policies yet, apply default Balanced preset
    if (policies.length === 0) {
      policies = await this.applyPreset(principal, "balanced");
    }

    // Resolve relationship context
    const relContext = await relationshipService.getRelationshipContext(principal, fromAddr);
    const relationshipType = relContext.relationship?.type;

    let matchedPolicy: MailPolicy | undefined = undefined;
    let precedenceLevel = 0;
    let precedenceName = "none";

    const userLevel = classification ? this.mapSemanticToUserLevel(classification, signals) : undefined;
    const confidence = classification?.confidence ?? 1;

    // 1. Check Message override / Thread override
    for (const p of policies) {
      if (p.scope === "message" && p.targetValue === email.id) {
        matchedPolicy = p;
        precedenceLevel = 700;
        precedenceName = "explicit_message_override";
        break;
      }
      if (p.scope === "thread" && p.targetValue && p.targetValue === email.providerThreadId) {
        matchedPolicy = p;
        precedenceLevel = 600;
        precedenceName = "explicit_thread_override";
        break;
      }
    }

    // 2. Check Sender / Domain rule
    if (!matchedPolicy) {
      for (const p of policies) {
        if (p.scope === "sender" && p.targetValue?.toLowerCase() === fromAddr) {
          matchedPolicy = p;
          precedenceLevel = 500;
          precedenceName = "explicit_sender_rule";
          break;
        }
        if (p.scope === "domain" && p.targetValue?.toLowerCase() === domain) {
          matchedPolicy = p;
          precedenceLevel = 450;
          precedenceName = "explicit_domain_rule";
          break;
        }
      }
    }

    // 3. Check Relationship rule
    if (!matchedPolicy && relationshipType) {
      for (const p of policies) {
        if (p.scope === "relationship" && p.targetValue?.toLowerCase() === relationshipType.toLowerCase()) {
          matchedPolicy = p;
          precedenceLevel = 400;
          precedenceName = "explicit_relationship_rule";
          break;
        }
      }
    }

    // 4. Check Organization / Project rule
    if (!matchedPolicy && relContext.organization) {
      for (const p of policies) {
        if (p.scope === "organization" && p.targetValue === relContext.organization.id) {
          matchedPolicy = p;
          precedenceLevel = 300;
          precedenceName = "organization_rule";
          break;
        }
      }
    }

    // 5. Check Account rule
    if (!matchedPolicy) {
      for (const p of policies) {
        if (p.scope === "account" && p.targetValue === email.accountId) {
          matchedPolicy = p;
          precedenceLevel = 200;
          precedenceName = "account_rule";
          break;
        }
      }
    }

    // 6. Check Classification policy (user-defined first, then system preset)
    if (!matchedPolicy && classification && userLevel) {
      const classPolicies = policies.filter(
        (p) =>
          p.scope === "classification" &&
          (p.targetValue?.toLowerCase() === userLevel ||
            p.classification === userLevel ||
            p.targetValue?.toLowerCase() === classification!.category.toLowerCase())
      );

      // Prioritize user-defined rules over system preset defaults
      classPolicies.sort((a, b) => (b.isSystemPreset ? 0 : 1) - (a.isSystemPreset ? 0 : 1));

      if (classPolicies.length > 0 && classPolicies[0]) {
        matchedPolicy = classPolicies[0];
        precedenceLevel = matchedPolicy.isSystemPreset ? 100 : 150;
        precedenceName = matchedPolicy.isSystemPreset ? "classification_preset_policy" : "user_classification_policy";
      }
    }

    // 7. Global default fallback
    if (!matchedPolicy) {
      const globalPolicy = policies.find((p) => p.scope === "global");
      if (globalPolicy) {
        matchedPolicy = globalPolicy;
        precedenceLevel = 10;
        precedenceName = "global_policy";
      }
    }

    // Determine applied action
    let appliedAction: PolicyAction = matchedPolicy ? matchedPolicy.action : "leave";
    const minConf = (matchedPolicy?.minimumConfidence ?? 80) / 100;

    let reason = matchedPolicy
      ? `Matched rule: '${matchedPolicy.name}' (${precedenceName})`
      : "No matching policy found; leaving message in inbox.";

    if (confidence < minConf && appliedAction !== "leave") {
      reason = `Confidence (${Math.round(confidence * 100)}%) is below minimum threshold (${Math.round(minConf * 100)}%); leaving message in inbox.`;
      appliedAction = "leave";
    }

    // Safety invariant: never allow permanent deletion by default
    if (appliedAction === "delete" && (!matchedPolicy || matchedPolicy.isSystemPreset)) {
      appliedAction = "archive";
      reason += " (Permanent deletion not allowed by default; changed to archive)";
    }

    const isDryRun = !config.MAILBOX_MUTATIONS_ENABLED;

    return {
      messageId: email.id,
      // Deprecated compatibility field. No semantic classification is inferred during ingestion.
      evaluatedClassification: userLevel ?? "routine",
      confidence,
      matchedPolicy,
      precedenceLevel,
      precedenceName,
      appliedAction,
      destination: matchedPolicy?.destination,
      simulated: isDryRun,
      actionExecuted: false,
      reason,
      details: {
        sender: fromAddr,
        relationship: relationshipType,
        organization: relContext.organization?.name,
        account: email.accountId,
        threadId: email.providerThreadId,
      },
    };
  }

  /**
   * Executes the policy action for an ingested email (respecting dry-run mode across ALL action types)
   */
  async executePolicy(
    principal: AuthPrincipal,
    email: NormalizedEmail,
    evaluation: PolicyEvaluationResult
  ): Promise<void> {
    const action = evaluation.appliedAction;
    const isDryRun = evaluation.simulated;
    const now = new Date();

    // Map action to mailbox action type record
    const mailboxActionType =
      action === "archive"
        ? "archive"
        : action === "mark_read"
        ? "mark_read"
        : action === "keep_unread"
        ? "mark_unread"
        : action === "delete"
        ? "delete"
        : action === "label"
        ? "label"
        : action === "move"
        ? "move"
        : action;

    // Record mailbox action in database (tracked for both live and simulated executions)
    await db.insert(schema.mailboxActions).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId: email.accountId,
      messageId: email.id,
      action: mailboxActionType as any,
      status: isDryRun ? "simulated" : "success",
      createdAt: now,
    });

    if (!isDryRun) {
      const flags = { ...email.flags };
      if (action === "archive") flags.archived = true;
      if (action === "mark_read") flags.unread = false;
      if (action === "keep_unread") flags.unread = true;
      if (action === "surface" || action === "prioritize") flags.starred = true;

      await db
        .update(schema.emails)
        .set({ flags, updatedAt: now })
        .where(
          and(
            eq(schema.emails.id, email.id),
            eq(schema.emails.tenantId, principal.tenantId),
            eq(schema.emails.userId, principal.userId)
          )
        );
    }

    // Comprehensive audit log with complete details for dry-run and live executions
    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: (isDryRun ? `POLICY_WOULD_${action.toUpperCase()}` : `POLICY_EXECUTED_${action.toUpperCase()}`) as any,
      resourceType: "email",
      resourceId: email.id,
      status: isDryRun ? "simulated" : "success",
      details: {
        action,
        destination: evaluation.destination,
        matchedPolicyId: evaluation.matchedPolicy?.id,
        policyName: evaluation.matchedPolicy?.name,
        precedenceName: evaluation.precedenceName,
        precedenceLevel: evaluation.precedenceLevel,
        confidence: evaluation.confidence,
        classification: evaluation.evaluatedClassification,
        reason: evaluation.reason,
        simulated: isDryRun,
      },
    });

    logger.info(
      `[POLICY ENGINE] ${isDryRun ? "[DRY RUN] WOULD_" : ""}${action.toUpperCase()} email=${email.id} reason="${evaluation.reason}"`
    );
  }

  /**
   * Parses conversational rule text into a persistent structured policy
   */
  async createConversationalPolicy(
    principal: AuthPrincipal,
    prompt: string
  ): Promise<MailPolicy> {
    const text = prompt.toLowerCase().trim();

    let name = prompt.trim();
    let scope: PolicyScope = "classification";
    let targetValue: string | undefined = undefined;
    let classification: UserLevelClassification | "any" | undefined = undefined;
    let action: PolicyAction = "leave";
    let destination: string | undefined = undefined;
    let minimumConfidence = 80;

    // Pattern matching for natural language configuration
    if (text.includes("archive") && (text.includes("newsletter") || text.includes("newsletters"))) {
      name = "Archive newsletters automatically";
      scope = "classification";
      targetValue = "newsletter";
      classification = "junk";
      action = "archive";
    } else if ((text.includes("never archive") || text.includes("don't archive") || text.includes("dont archive")) && text.includes("recruiter")) {
      name = "Never archive recruiter emails";
      scope = "relationship";
      targetValue = "recruiter";
      classification = "important";
      action = "leave";
    } else if (text.includes("client") && (text.includes("important") || text.includes("critical"))) {
      name = "Client emails are important";
      scope = "relationship";
      targetValue = "client";
      classification = "important";
      action = "prioritize";
    } else if (text.includes("receipt") || text.includes("receipts") || text.includes("invoice")) {
      name = "Put receipts in Finance";
      scope = "classification";
      targetValue = "financial";
      action = "label";
      destination = "Finance";
    } else if (text.includes("github") && text.includes("routine")) {
      name = "Mark GitHub notifications as routine";
      scope = "sender";
      targetValue = "notifications@github.com";
      classification = "routine";
      action = "leave";
    } else if (text.includes("@")) {
      const emailOrDomainMatch = prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailOrDomainMatch && emailOrDomainMatch[1]) {
        const matched = emailOrDomainMatch[1];
        if (matched.startsWith("@")) {
          name = `Everything from ${matched} is important`;
          scope = "domain";
          targetValue = matched.replace("@", "");
          classification = "important";
          action = "prioritize";
        } else {
          name = `Rule for ${matched}`;
          scope = "sender";
          targetValue = matched.toLowerCase();
          classification = text.includes("critical") ? "critical" : text.includes("important") ? "important" : "routine";
          action = text.includes("archive") ? "archive" : "leave";
        }
      }
    } else if (text.includes("never delete") || text.includes("don't delete") || text.includes("dont delete")) {
      name = "Never delete automatically";
      scope = "global";
      action = "leave";
    }

    return this.setPolicy(principal, {
      name,
      scope,
      targetValue,
      classification,
      action,
      destination,
      minimumConfidence,
      enabled: true,
      userPrompt: prompt,
    });
  }

  /**
   * Explains why a policy mutation or decision occurred for a specific message
   */
  async explainPolicyDecision(
    principal: AuthPrincipal,
    messageId: string
  ): Promise<{
    messageId: string;
    explanation: string;
    action?: string;
    destination?: string;
    policyName?: string;
    precedenceName?: string;
    confidence?: number;
    classification?: string;
    reason?: string;
    simulated?: boolean;
    events: any[];
  }> {
    authService.requirePrincipal(principal);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.tenantId, principal.tenantId),
          eq(schema.auditEvents.resourceId, messageId)
        )
      )
      .orderBy(desc(schema.auditEvents.timestamp));

    const policyAudit = audits.find((a: any) =>
      a.action.startsWith("POLICY_") || a.action.startsWith("DRY_RUN_") || a.action.startsWith("MAIL_")
    );

    if (policyAudit && policyAudit.details) {
      let d = policyAudit.details;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          // ignore
        }
      }
      const explanation = d.reason || `Message matched rule '${d.policyName || "default"}' with action '${d.action}'`;
      return {
        messageId,
        explanation,
        action: d.action,
        destination: d.destination,
        policyName: d.policyName,
        precedenceName: d.precedenceName,
        confidence: d.confidence,
        classification: d.classification,
        reason: d.reason,
        simulated: d.simulated ?? !config.MAILBOX_MUTATIONS_ENABLED,
        events: audits,
      };
    }

    return {
      messageId,
      explanation: "No policy action recorded for this message.",
      simulated: !config.MAILBOX_MUTATIONS_ENABLED,
      events: audits,
    };
  }

  /**
   * Retrieves pending policy suggestions for occasional non-intrusive improvements
   */
  async getSuggestions(principal: AuthPrincipal): Promise<PolicySuggestion[]> {
    authService.requirePrincipal(principal);

    const rows = await db
      .select()
      .from(schema.policySuggestions)
      .where(
        and(
          eq(schema.policySuggestions.tenantId, principal.tenantId),
          eq(schema.policySuggestions.userId, principal.userId),
          eq(schema.policySuggestions.status, "pending")
        )
      );

    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      suggestion: r.suggestion,
      suggestedPolicy: r.suggestedPolicy,
      status: r.status as any,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Accepts a suggestion, creating the persistent policy
   */
  async acceptSuggestion(principal: AuthPrincipal, suggestionId: string): Promise<MailPolicy> {
    authService.requirePrincipal(principal);

    const [suggestion] = await db
      .select()
      .from(schema.policySuggestions)
      .where(
        and(
          eq(schema.policySuggestions.id, suggestionId),
          eq(schema.policySuggestions.tenantId, principal.tenantId),
          eq(schema.policySuggestions.userId, principal.userId)
        )
      )
      .limit(1);

    if (!suggestion) {
      throw new ValidationError(`Policy suggestion '${suggestionId}' not found`);
    }

    const p = suggestion.suggestedPolicy as any;
    const createdPolicy = await this.setPolicy(principal, {
      name: p.name,
      scope: p.scope,
      targetValue: p.targetValue,
      classification: p.classification,
      action: p.action,
      destination: p.destination,
      minimumConfidence: p.minimumConfidence,
      userPrompt: p.userPrompt,
    });

    await db
      .update(schema.policySuggestions)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(schema.policySuggestions.id, suggestionId));

    return createdPolicy;
  }

  /**
   * Dismisses a suggestion
   */
  async dismissSuggestion(principal: AuthPrincipal, suggestionId: string): Promise<void> {
    authService.requirePrincipal(principal);

    await db
      .update(schema.policySuggestions)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(
        and(
          eq(schema.policySuggestions.id, suggestionId),
          eq(schema.policySuggestions.tenantId, principal.tenantId),
          eq(schema.policySuggestions.userId, principal.userId)
        )
      );
  }
}

export const policyService = new PolicyService();
