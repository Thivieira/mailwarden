import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { policyService } from "../src/services/policy";
import { userPreferencesService } from "../src/services/user-preferences";
import { localizationService } from "../src/services/localization";
import { relationshipService } from "../src/services/relationships";
import { attentionService } from "../src/services/attention";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { config } from "../src/config";

describe("Mailwarden Product Enrichment & Policy Engine", () => {
  let principal: AuthPrincipal;
  let otherPrincipal: AuthPrincipal;
  let accountId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Test Org ${id}`,
      slug: `test-org-${id}`,
      ownerEmail: `user-${id}@example.com`,
      ownerDisplayName: "Test Owner",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
    };

    const otherId = nanoid();
    const otherCreated = await authService.createTenantAndOwner({
      tenantName: `Other Org ${otherId}`,
      slug: `other-org-${otherId}`,
      ownerEmail: `other-${otherId}@example.com`,
      ownerDisplayName: "Other Owner",
    });

    otherPrincipal = {
      tenantId: otherCreated.tenantId,
      userId: otherCreated.userId,
      scopes: ALL_SCOPES,
    };

    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Work Account",
      emailAddress: `work-${id}@example.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    otherAccountId = nanoid();
    await db.insert(schema.emailAccounts).values({
      id: otherAccountId,
      tenantId: otherPrincipal.tenantId,
      userId: otherPrincipal.userId,
      provider: "mock",
      displayName: "Other Work Account",
      emailAddress: `other-work-${otherId}@example.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  // =========================================================================
  // 1. RECOMMENDED DEFAULTS & PRESETS
  // =========================================================================
  describe("Recommended Defaults & Presets", () => {
    it("Seeds balanced preset by default with safe invariants", async () => {
      const policies = await policyService.applyPreset(principal, "balanced");
      expect(policies.length).toBeGreaterThanOrEqual(4);

      const junkPolicy = policies.find((p) => p.targetValue === "junk");
      expect(junkPolicy).toBeDefined();
      expect(junkPolicy!.action).toBe("archive");
      expect(junkPolicy!.action).not.toBe("delete");

      const routinePolicy = policies.find((p) => p.targetValue === "routine");
      expect(routinePolicy).toBeDefined();
      expect(routinePolicy!.action).toBe("leave");

      const criticalPolicy = policies.find((p) => p.targetValue === "critical");
      expect(criticalPolicy).toBeDefined();
      expect(criticalPolicy!.action).toBe("surface");
    });

    it("Applies Safe and Inbox Zero presets properly", async () => {
      const safePolicies = await policyService.applyPreset(principal, "safe");
      const safeJunk = safePolicies.find((p) => p.targetValue === "junk");
      expect(safeJunk!.action).toBe("leave");

      const inboxZeroPolicies = await policyService.applyPreset(principal, "inbox_zero");
      const zeroRoutine = inboxZeroPolicies.find((p) => p.targetValue === "routine");
      expect(zeroRoutine!.action).toBe("archive");
    });
  });

  // =========================================================================
  // 2. POLICY PRECEDENCE HIERARCHY
  // =========================================================================
  describe("Policy Precedence Hierarchy", () => {
    it("Explicit sender rule beats global classification rule", async () => {
      // 1. Apply balanced preset (where junk / newsletter is archived)
      await policyService.applyPreset(principal, "balanced");

      // 2. Add user override: "Artificial Analysis newsletter should be interesting/leave"
      await policyService.setPolicy(principal, {
        name: "Keep AI Newsletter",
        scope: "sender",
        targetValue: "newsletter@artificialanalysis.ai",
        classification: "interesting",
        action: "leave",
      });

      // 3. Ingest email from this specific sender with newsletter headers
      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${nanoid()}`,
        from: { name: "AI News", address: "newsletter@artificialanalysis.ai" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Weekly State of AI Models",
        textBody: "Here is the weekly analysis.",
        receivedAt: new Date(),
        headers: { "list-unsubscribe": "<mailto:unsub@example.com>" },
        flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
        attachments: [],
      });

      // Policy decision explanation
      const explanation = await policyService.explainPolicyDecision(principal, email.id);
      expect(explanation.explanation).toContain("Keep AI Newsletter");
    });

    it("Explicit user relationship beats inferred classification behavior", async () => {
      await policyService.applyPreset(principal, "balanced");

      // Set sender relationship as client
      await relationshipService.setSenderRelationship(principal, {
        emailAddress: "client-contact@acme.corp",
        type: "client",
      });

      // User has rule: "never archive recruiter/client emails"
      await policyService.setPolicy(principal, {
        name: "Client Priority",
        scope: "relationship",
        targetValue: "client",
        action: "prioritize",
        classification: "important",
      });

      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${nanoid()}`,
        from: { name: "Acme Client", address: "client-contact@acme.corp" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Project Deliverables Update",
        textBody: "Please find the requested update.",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });

      const explanation = await policyService.explainPolicyDecision(principal, email.id);
      expect(explanation.explanation).toContain("Client Priority");
    });

    it("Explicit message override outranks sender rule", async () => {
      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${nanoid()}`,
        from: { name: "Special Sender", address: "special@example.com" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Specific Message Test",
        textBody: "Specific message body",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });

      // Sender rule
      await policyService.setPolicy(principal, {
        name: "General Sender Rule",
        scope: "sender",
        targetValue: "special@example.com",
        action: "archive",
      });

      // Specific Message override
      await policyService.setPolicy(principal, {
        name: "Specific Message Override",
        scope: "message",
        targetValue: email.id,
        action: "leave",
      });

      // Evaluate policies directly
      const [cls] = await db
        .select()
        .from(schema.classifications)
        .where(eq(schema.classifications.emailId, email.id));

      const evaluation = await policyService.evaluatePolicies(principal, email, cls as any, {
        knownSender: true,
        knownRelationship: false,
        activeThread: false,
        userPreviouslyReplied: false,
        bulk: false,
        newsletter: false,
        automated: false,
        transactional: false,
        likelyClient: false,
        likelyRecruiter: false,
        likelyFinancial: false,
        likelySecurityRelated: false,
        hasListUnsubscribe: false,
        ruleHits: [],
      });

      expect(evaluation.matchedPolicy?.name).toBe("Specific Message Override");
      expect(evaluation.precedenceLevel).toBe(700);
      expect(evaluation.appliedAction).toBe("leave");
    });
  });

  // =========================================================================
  // 3. CONFIDENCE-BASED MUTATIONS
  // =========================================================================
  describe("Confidence Behavior", () => {
    it("Leaves message untouched when confidence is below minimum threshold", async () => {
      await policyService.setPolicy(principal, {
        name: "High Confidence Archive",
        scope: "classification",
        targetValue: "junk",
        action: "archive",
        minimumConfidence: 95, // strict 95% requirement
      });

      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${nanoid()}`,
        from: { address: "maybe-junk@example.com" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Uncertain Promo",
        textBody: "Promo content",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });

      // Low-confidence dummy classification (70%)
      const lowConfCls: any = {
        importance: "low",
        category: "junk",
        workflowState: "junk",
        confidence: 0.70, // below 95%
      };

      const evaluation = await policyService.evaluatePolicies(principal, email, lowConfCls, {
        knownSender: false,
        knownRelationship: false,
        activeThread: false,
        userPreviouslyReplied: false,
        bulk: false,
        newsletter: false,
        automated: false,
        transactional: false,
        likelyClient: false,
        likelyRecruiter: false,
        likelyFinancial: false,
        likelySecurityRelated: false,
        hasListUnsubscribe: false,
        ruleHits: [],
      });

      expect(evaluation.appliedAction).toBe("leave");
      expect(evaluation.reason).toContain("below minimum threshold");
    });
  });

  // =========================================================================
  // 4. ONBOARDING & PERSISTENCE
  // =========================================================================
  describe("First-Run Onboarding Flow", () => {
    it("Starts as incomplete, then persists preset and language on completion", async () => {
      const initialPrefs = await userPreferencesService.getPreferences(principal);
      expect(initialPrefs.onboardingCompleted).toBe(false);

      // Complete onboarding with Portuguese preference
      const completed = await userPreferencesService.completeOnboarding(principal, {
        preset: "balanced",
        language: "pt-BR",
      });

      expect(completed.onboardingCompleted).toBe(true);
      expect(completed.onboardingCompletedAt).toBeDefined();
      expect(completed.preferredLanguage).toBe("pt-BR");
      expect(completed.selectedPreset).toBe("balanced");
    });

    it("Allows resetting onboarding for help or re-configuration", async () => {
      await userPreferencesService.completeOnboarding(principal, { preset: "balanced" });
      const reset = await userPreferencesService.resetOnboarding(principal);
      expect(reset.onboardingCompleted).toBe(false);
    });
  });

  // =========================================================================
  // 5. LOCALIZATION ARCHITECTURE & FALLBACK
  // =========================================================================
  describe("Localization Architecture & Fallback", () => {
    it("Returns correct PT-BR and English onboarding and help copy", () => {
      const enContent = localizationService.getContent("en");
      expect(enContent.onboardingWelcome).toContain("Welcome to Mailwarden");
      expect(enContent.onboardingWelcome).toContain("Archive newsletters automatically");
      expect(enContent.help.tagline).toBeDefined();

      const ptContent = localizationService.getContent("pt-BR");
      expect(ptContent.onboardingWelcome).toContain("Bem-vindo ao Mailwarden");
      expect(ptContent.onboardingWelcome).toContain("Arquive newsletters automaticamente");
      expect(ptContent.onboardingChoices.recommended).toBe("Usar as configurações recomendadas");
      expect(ptContent.help.tagline).toBeDefined();
    });

    it("Gracefully falls back to English for unsupported locales (e.g. fr-FR, de, ja)", () => {
      // fr-FR is unsupported, should fall back to English
      const locale = localizationService.resolveLocale({ requestLanguage: "fr-FR" });
      expect(locale).toBe("en");

      const content = localizationService.getContent(locale);
      expect(content.onboardingWelcome).toContain("Welcome to Mailwarden");

      const deLocale = localizationService.resolveLocale({ userLocale: "de-DE" });
      expect(deLocale).toBe("en");
    });

    it("Resolves locale priority: saved preference > request language > session locale > user locale > fallback", () => {
      // 1. Saved preference outranks request language
      expect(
        localizationService.resolveLocale({
          savedPreference: "pt-BR",
          requestLanguage: "en-US",
        })
      ).toBe("pt-BR");

      // 2. Request language used when no saved preference exists
      expect(
        localizationService.resolveLocale({
          requestLanguage: "portuguese",
          userLocale: "en-US",
        })
      ).toBe("pt-BR");

      // 3. Session locale used when no saved pref or request lang
      expect(
        localizationService.resolveLocale({
          sessionLocale: "pt-BR",
        })
      ).toBe("pt-BR");

      // 4. Default fallback to en
      expect(localizationService.resolveLocale({})).toBe("en");
    });

    it("Keeps internal data models and enums strictly language-neutral", async () => {
      // Complete onboarding in Portuguese
      await userPreferencesService.completeOnboarding(principal, {
        preset: "balanced",
        language: "pt-BR",
      });

      const policies = await policyService.getUserPolicies(principal);
      // Verify internal values are still neutral English enums
      for (const p of policies) {
        expect(["leave", "archive", "mark_read", "keep_unread", "label", "move", "delete", "surface", "prioritize"]).toContain(p.action);
        expect(["global", "classification", "account", "organization", "project", "relationship", "sender", "domain", "thread", "message"]).toContain(p.scope);
      }
    });

    it("Allows dynamically registering new locales via extensible registry", () => {
      const initialLocales = localizationService.getSupportedLocales();
      expect(initialLocales).toContain("en");
      expect(initialLocales).toContain("pt-BR");

      // Register custom locale (e.g. es)
      const customContent = { ...localizationService.getContent("en"), onboardingWelcome: "Bienvenido a Mailwarden" };
      localizationService.registerLocale("es", customContent);

      expect(localizationService.getSupportedLocales()).toContain("es");
      expect(localizationService.getContent("es").onboardingWelcome).toBe("Bienvenido a Mailwarden");
    });
  });

  // =========================================================================
  // 6. SEMANTIC STRUCTURED POLICY BOUNDARY
  // =========================================================================
  describe("Semantic Structured Policy Boundary", () => {
    it("Handles Portuguese semantic intent: 'Tudo da Shay deixa na caixa'", async () => {
      // Conversational AI interprets "Tudo da Shay deixa na caixa" and calls set_mail_policy with structured intent
      const policy = await policyService.setPolicy(principal, {
        name: "Keep Shay's Emails",
        scope: "sender",
        targetValue: "shay@example.com",
        action: "leave",
        classification: "important",
      });

      expect(policy.scope).toBe("sender");
      expect(policy.targetValue).toBe("shay@example.com");
      expect(policy.action).toBe("leave");

      // Ingest email from Shay
      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_shay_${nanoid()}`,
        from: { name: "Shay", address: "shay@example.com" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Quick question about the project",
        textBody: "Hey, can you review this?",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      });

      const explanation = await policyService.explainPolicyDecision(principal, email.id);
      expect(explanation.action).toBe("leave");
      expect(explanation.explanation).toContain("Keep Shay's Emails");
    });

    it("Handles English semantic intent: 'I don't care about GitHub notifications'", async () => {
      // Conversational AI maps intent to domain-scoped archive rule
      const policy = await policyService.setPolicy(principal, {
        name: "Archive GitHub Notifications",
        scope: "domain",
        targetValue: "github.com",
        action: "archive",
        classification: "routine",
      });

      expect(policy.scope).toBe("domain");
      expect(policy.targetValue).toBe("github.com");
      expect(policy.action).toBe("archive");

      const email = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_gh_${nanoid()}`,
        from: { name: "GitHub", address: "notifications@github.com" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "[repo] Issue #42 updated",
        textBody: "New comment on issue #42",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
        attachments: [],
      });

      const explanation = await policyService.explainPolicyDecision(principal, email.id);
      expect(explanation.action).toBe("archive");
      expect(explanation.explanation).toContain("Archive GitHub Notifications");
    });

    it("Handles conditional semantic intent: 'Archive newsletters except Artificial Analysis'", async () => {
      // 1. Global / classification newsletter archive rule
      await policyService.setPolicy(principal, {
        name: "Archive All Newsletters",
        scope: "classification",
        targetValue: "junk",
        action: "archive",
      });

      // 2. Specific sender exception override
      await policyService.setPolicy(principal, {
        name: "Keep Artificial Analysis",
        scope: "sender",
        targetValue: "newsletter@artificialanalysis.ai",
        action: "leave",
        classification: "interesting",
      });

      // Regular newsletter -> should be archived
      const regularNews = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_reg_news_${nanoid()}`,
        from: { address: "weekly@randomtech.com" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "Random Tech Weekly Digest",
        textBody: "Digest content",
        receivedAt: new Date(),
        headers: { "list-unsubscribe": "<mailto:unsub@randomtech.com>" },
        flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
        attachments: [],
      });

      const regExp = await policyService.explainPolicyDecision(principal, regularNews.id);
      expect(regExp.action).toBe("archive");

      // Artificial Analysis newsletter -> should be left visible (sender override wins over classification)
      const aaNews = await emailService.ingestEmail(principal, {
        accountId,
        provider: "mock",
        providerMessageId: `msg_aa_news_${nanoid()}`,
        from: { address: "newsletter@artificialanalysis.ai" },
        to: [{ address: "work@example.com" }],
        cc: [],
        bcc: [],
        subject: "AI Benchmark State of Models",
        textBody: "New benchmark results",
        receivedAt: new Date(),
        headers: { "list-unsubscribe": "<mailto:unsub@artificialanalysis.ai>" },
        flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
        attachments: [],
      });

      const aaExp = await policyService.explainPolicyDecision(principal, aaNews.id);
      expect(aaExp.action).toBe("leave");
      expect(aaExp.explanation).toContain("Keep Artificial Analysis");
    });
  });

  // =========================================================================
  // 7. SECURITY & MULTI-TENANT ISOLATION
  // =========================================================================
  describe("Security Invariants", () => {
    it("User cannot access or modify another tenant's policies", async () => {
      const policy = await policyService.setPolicy(principal, {
        name: "Private Rule",
        scope: "classification",
        targetValue: "routine",
        action: "leave",
      });

      // Other user tries to get or delete the policy
      const otherPolicies = await policyService.getUserPolicies(otherPrincipal);
      expect(otherPolicies.some((p) => p.id === policy.id)).toBe(false);

      // Attempting to delete other user's policy should affect 0 rows
      await policyService.removePolicy(otherPrincipal, policy.id);

      const stillExists = await policyService.getUserPolicies(principal);
      expect(stillExists.some((p) => p.id === policy.id)).toBe(true);
    });
  });
});
