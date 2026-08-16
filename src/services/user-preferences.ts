import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type { UserPreferences, PolicyPresetName } from "../types/policy";
import { authService } from "./auth";
import { auditService } from "./audit";
import { nanoid } from "nanoid";
import { localizationService, type SupportedLocale } from "./localization";

export class UserPreferencesService {
  /**
   * Retrieves or initializes preferences for a user in their tenant
   */
  async getPreferences(principal: AuthPrincipal): Promise<UserPreferences> {
    authService.requirePrincipal(principal);

    const [existing] = await db
      .select()
      .from(schema.userPreferences)
      .where(
        and(
          eq(schema.userPreferences.tenantId, principal.tenantId),
          eq(schema.userPreferences.userId, principal.userId)
        )
      )
      .limit(1);

    if (existing) {
      return {
        id: existing.id,
        tenantId: existing.tenantId,
        userId: existing.userId,
        onboardingCompleted: Boolean(existing.onboardingCompleted),
        onboardingCompletedAt: existing.onboardingCompletedAt || undefined,
        preferredLanguage: existing.preferredLanguage || "en",
        selectedPreset: (existing.selectedPreset || "balanced") as PolicyPresetName,
        policyDryRun: Boolean(existing.policyDryRun),
        customSettings: existing.customSettings ? (existing.customSettings as Record<string, any>) : undefined,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const now = new Date();
    const id = nanoid();

    await db.insert(schema.userPreferences).values({
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      onboardingCompleted: false,
      preferredLanguage: "en",
      selectedPreset: "balanced",
      policyDryRun: true,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      onboardingCompleted: false,
      preferredLanguage: "en",
      selectedPreset: "balanced",
      policyDryRun: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Completes the first-run onboarding and persists choices
   */
  async completeOnboarding(
    principal: AuthPrincipal,
    params: {
      preset?: PolicyPresetName;
      language?: string;
      customSettings?: Record<string, any>;
    }
  ): Promise<UserPreferences> {
    authService.requirePrincipal(principal);

    const prefs = await this.getPreferences(principal);
    const now = new Date();
    const selectedPreset = params.preset || prefs.selectedPreset || "balanced";
    const preferredLanguage = params.language
      ? localizationService.resolveLocale({ requestLanguage: params.language })
      : prefs.preferredLanguage;

    await db
      .update(schema.userPreferences)
      .set({
        onboardingCompleted: true,
        onboardingCompletedAt: now,
        selectedPreset,
        preferredLanguage,
        customSettings: params.customSettings || prefs.customSettings || null,
        updatedAt: now,
      })
      .where(eq(schema.userPreferences.id, prefs.id));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "ONBOARDING_COMPLETED",
      resourceType: "user_preferences",
      resourceId: prefs.id,
      details: { selectedPreset, preferredLanguage },
    });

    return this.getPreferences(principal);
  }

  /**
   * Updates user preferences (language, preset, dry run, etc.)
   */
  async updatePreferences(
    principal: AuthPrincipal,
    updates: {
      preferredLanguage?: string;
      selectedPreset?: PolicyPresetName;
      policyDryRun?: boolean;
      customSettings?: Record<string, any>;
    }
  ): Promise<UserPreferences> {
    authService.requirePrincipal(principal);

    const prefs = await this.getPreferences(principal);
    const now = new Date();

    const normalizedLang = updates.preferredLanguage
      ? localizationService.resolveLocale({ requestLanguage: updates.preferredLanguage })
      : undefined;

    await db
      .update(schema.userPreferences)
      .set({
        ...(normalizedLang ? { preferredLanguage: normalizedLang } : {}),
        ...(updates.selectedPreset ? { selectedPreset: updates.selectedPreset } : {}),
        ...(updates.policyDryRun !== undefined ? { policyDryRun: updates.policyDryRun } : {}),
        ...(updates.customSettings ? { customSettings: updates.customSettings } : {}),
        updatedAt: now,
      })
      .where(eq(schema.userPreferences.id, prefs.id));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "USER_PREFERENCES_UPDATE",
      resourceType: "user_preferences",
      resourceId: prefs.id,
      details: updates,
    });

    return this.getPreferences(principal);
  }

  /**
   * Resets onboarding status so the user can re-experience onboarding flow
   */
  async resetOnboarding(principal: AuthPrincipal): Promise<UserPreferences> {
    authService.requirePrincipal(principal);

    const prefs = await this.getPreferences(principal);
    const now = new Date();

    await db
      .update(schema.userPreferences)
      .set({
        onboardingCompleted: false,
        onboardingCompletedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.userPreferences.id, prefs.id));

    return this.getPreferences(principal);
  }
}

export const userPreferencesService = new UserPreferencesService();
