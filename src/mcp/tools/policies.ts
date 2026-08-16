import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { policyService } from "../../services/policy";
import { userPreferencesService } from "../../services/user-preferences";
import { localizationService } from "../../services/localization";
import { authService } from "../../services/auth";
import { config } from "../../config";

export const policyTools = [
  {
    name: "get_mail_policies",
    description: "Returns the user's active email rules, active preset name, dry-run mutation status, and human-readable policy summary.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const prefs = await userPreferencesService.getPreferences(principal);
      const policies = await policyService.getUserPolicies(principal);
      const locale = localizationService.resolveLocale({ savedPreference: prefs.preferredLanguage });
      const content = localizationService.getContent(locale);

      const activeRules = policies.filter((p) => p.enabled);

      const summaryList = activeRules.map((p) => {
        return `${p.name}: [${p.scope}] -> action: ${p.action}${p.destination ? ` (${p.destination})` : ""}`;
      });

      return {
        activePreset: prefs.selectedPreset,
        dryRunEnabled: !config.MAILBOX_MUTATIONS_ENABLED,
        ruleCount: activeRules.length,
        rules: activeRules,
        summary: summaryList,
        presetDescription:
          prefs.selectedPreset === "safe"
            ? content.policyDescriptions.safePreset
            : prefs.selectedPreset === "inbox_zero"
            ? content.policyDescriptions.inboxZeroPreset
            : content.policyDescriptions.balancedPreset,
      };
    },
  },
  {
    name: "set_mail_policy",
    description: "Authoritative interface to create or update an email action policy with structured semantic intent (scope, target, action, destination, confidence, priority).",
    parameters: z.object({
      name: z.string().optional().describe("Human-readable rule name, e.g. 'Keep AI Newsletter' or 'Client Priority'"),
      scope: z
        .enum([
          "global",
          "classification",
          "account",
          "organization",
          "project",
          "relationship",
          "sender",
          "domain",
          "thread",
          "message",
        ])
        .optional()
        .describe("Scope of policy matching"),
      targetId: z.string().optional().describe("Target entity ID (e.g. message ID, thread ID, account ID, project ID, org ID)"),
      targetValue: z.string().optional().describe("Target identifier (e.g. sender email address, domain 'acme.com', relationship type 'client', or category 'junk')"),
      classification: z
        .enum(["junk", "routine", "interesting", "important", "critical", "any"])
        .optional()
        .describe("Classification category filter"),
      action: z
        .enum([
          "leave",
          "archive",
          "mark_read",
          "keep_unread",
          "label",
          "move",
          "delete",
          "surface",
          "prioritize",
        ])
        .optional()
        .describe("Action to take when matched"),
      destination: z.string().optional().describe("Destination folder or label name (e.g. 'Finance', 'Invoices', 'Archive')"),
      minimumConfidence: z.number().int().min(0).max(100).optional().describe("Minimum confidence percentage (0-100, default 80)"),
      priority: z.number().int().optional().describe("Precedence priority override"),
      enabled: z.boolean().optional().describe("Whether this rule is active (default true)"),
      conversationalPrompt: z
        .string()
        .optional()
        .describe("Original natural language instruction text if applicable"),
    }),
    handler: async (
      principal: AuthPrincipal,
      params: {
        name?: string;
        scope?: any;
        targetId?: string;
        targetValue?: string;
        classification?: any;
        action?: any;
        destination?: string;
        minimumConfidence?: number;
        priority?: number;
        enabled?: boolean;
        conversationalPrompt?: string;
      }
    ) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      if (params.conversationalPrompt && (!params.name || !params.action)) {
        const policy = await policyService.createConversationalPolicy(principal, params.conversationalPrompt);
        return {
          success: true,
          message: `Created policy '${policy.name}' for instruction: "${params.conversationalPrompt}"`,
          policy,
        };
      }

      const policy = await policyService.setPolicy(principal, {
        name: params.name || (params.targetValue ? `Rule for ${params.targetValue}` : "Custom Rule"),
        scope: params.scope || "classification",
        targetId: params.targetId,
        targetValue: params.targetValue || params.targetId,
        classification: params.classification,
        action: params.action || "leave",
        destination: params.destination,
        minimumConfidence: params.minimumConfidence ?? 80,
        priority: params.priority,
        enabled: params.enabled ?? true,
        userPrompt: params.conversationalPrompt,
      });

      return {
        success: true,
        message: `Saved policy '${policy.name}'`,
        policy,
      };
    },
  },
  {
    name: "remove_mail_policy",
    description: "Deletes a specific user mail policy by ID.",
    parameters: z.object({
      policyId: z.string().describe("The ID of the policy to remove"),
    }),
    handler: async (principal: AuthPrincipal, params: { policyId: string }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      await policyService.removePolicy(principal, params.policyId);
      return { success: true, message: `Removed policy ${params.policyId}` };
    },
  },
  {
    name: "reset_mail_policies",
    description: "Resets user email policies to a standard preset (Balanced, Safe, or Inbox Zero).",
    parameters: z.object({
      preset: z.enum(["balanced", "safe", "inbox_zero"]).default("balanced").describe("The preset to reset to"),
    }),
    handler: async (principal: AuthPrincipal, params: { preset: "balanced" | "safe" | "inbox_zero" }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const policies = await policyService.applyPreset(principal, params.preset);
      await userPreferencesService.updatePreferences(principal, { selectedPreset: params.preset });

      return {
        success: true,
        preset: params.preset,
        ruleCount: policies.length,
        message: `Reset email rules to the '${params.preset}' preset.`,
      };
    },
  },
  {
    name: "get_policy_audit",
    description: "Explains why an email was classified, prioritized, or acted upon by Mailwarden (e.g. 'Why did you archive this?').",
    parameters: z.object({
      messageId: z.string().describe("The message ID to inspect"),
    }),
    handler: async (principal: AuthPrincipal, params: { messageId: string }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "mail.read");

      const result = await policyService.explainPolicyDecision(principal, params.messageId);
      return result;
    },
  },
  {
    name: "get_policy_suggestions",
    description: "Retrieves non-intrusive policy suggestions based on observed user email patterns.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      authService.requirePrincipal(principal);
      const suggestions = await policyService.getSuggestions(principal);
      return { suggestions };
    },
  },
  {
    name: "accept_policy_suggestion",
    description: "Accepts an automated policy suggestion and activates the persistent rule.",
    parameters: z.object({
      suggestionId: z.string().describe("The ID of the suggestion to accept"),
    }),
    handler: async (principal: AuthPrincipal, params: { suggestionId: string }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const policy = await policyService.acceptSuggestion(principal, params.suggestionId);
      return { success: true, policy };
    },
  },
  {
    name: "dismiss_policy_suggestion",
    description: "Dismisses an automated policy suggestion.",
    parameters: z.object({
      suggestionId: z.string().describe("The ID of the suggestion to dismiss"),
    }),
    handler: async (principal: AuthPrincipal, params: { suggestionId: string }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      await policyService.dismissSuggestion(principal, params.suggestionId);
      return { success: true };
    },
  },
];
