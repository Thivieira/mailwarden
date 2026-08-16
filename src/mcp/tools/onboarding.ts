import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { userPreferencesService } from "../../services/user-preferences";
import { policyService } from "../../services/policy";
import { localizationService, type SupportedLocale } from "../../services/localization";
import { authService } from "../../services/auth";

export const onboardingTools = [
  {
    name: "get_onboarding_status",
    description: "Checks whether the user has completed first-run onboarding. If incomplete, returns the non-technical conversational onboarding introduction in the user's preferred language.",
    parameters: z.object({
      language: z.string().optional().describe("Requested conversation language (e.g. 'en', 'pt-BR', 'pt')"),
    }),
    handler: async (principal: AuthPrincipal, params: { language?: string }) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const prefs = await userPreferencesService.getPreferences(principal);
      const locale = localizationService.resolveLocale({
        savedPreference: prefs.preferredLanguage,
        requestLanguage: params.language,
      });

      const content = localizationService.getContent(locale);

      return {
        onboardingCompleted: prefs.onboardingCompleted,
        onboardingCompletedAt: prefs.onboardingCompletedAt?.toISOString(),
        preferredLanguage: prefs.preferredLanguage,
        selectedPreset: prefs.selectedPreset,
        welcomeMessage: content.onboardingWelcome,
        choices: [content.onboardingChoices.recommended, content.onboardingChoices.customize],
      };
    },
  },
  {
    name: "complete_onboarding",
    description: "Completes the first-run onboarding by persisting the user's selected preset (Recommended Balanced, Safe, Inbox Zero, or Custom) and language preference.",
    parameters: z.object({
      preset: z.enum(["balanced", "safe", "inbox_zero", "custom"]).default("balanced").describe("The selected email policy preset"),
      language: z.string().optional().describe("User's preferred language (e.g. 'en', 'pt-BR')"),
      customSettings: z.record(z.string(), z.any()).optional().describe("Optional custom policy settings"),
    }),
    handler: async (
      principal: AuthPrincipal,
      params: { preset: "balanced" | "safe" | "inbox_zero" | "custom"; language?: string; customSettings?: any }
    ) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const updatedPrefs = await userPreferencesService.completeOnboarding(principal, {
        preset: params.preset,
        language: params.language,
        customSettings: params.customSettings,
      });

      // Apply the selected preset policies
      await policyService.applyPreset(principal, params.preset);

      const locale = localizationService.resolveLocale({ savedPreference: updatedPrefs.preferredLanguage });
      const content = localizationService.getContent(locale);

      const confirmationText =
        params.preset === "balanced" || params.preset === "safe" || params.preset === "inbox_zero"
          ? content.onboardingCompleted.recommended
          : content.onboardingCompleted.custom;

      return {
        success: true,
        preferences: updatedPrefs,
        message: confirmationText,
      };
    },
  },
  {
    name: "get_product_help",
    description: "Provides a compact, non-technical overview of Mailwarden capabilities, sample natural conversational prompts, and safe defaults in the user's preferred language.",
    parameters: z.object({
      language: z.string().optional().describe("Language for help response (e.g. 'en', 'pt-BR')"),
    }),
    handler: async (principal: AuthPrincipal, params: { language?: string }) => {
      authService.requirePrincipal(principal);

      const prefs = await userPreferencesService.getPreferences(principal);
      const locale = localizationService.resolveLocale({
        savedPreference: prefs.preferredLanguage,
        requestLanguage: params.language,
      });

      const content = localizationService.getContent(locale);

      return {
        tagline: content.help.tagline,
        summary: content.help.summary,
        capabilities: content.help.capabilities,
        sampleQueries: content.help.sampleQueries,
        safeDefaults: content.help.safeDefaults,
      };
    },
  },
];
