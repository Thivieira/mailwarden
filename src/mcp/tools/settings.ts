import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { policyService } from "../../services/policy";
import { userPreferencesService } from "../../services/user-preferences";
import { authService } from "../../services/auth";
import { config } from "../../config";

/**
 * The tool behind the settings MCP App.
 *
 * The spec's own guidance is to "keep tools useful without UI so the model can complete the
 * workflow in clients that do not render components", and that is load-bearing here: most
 * MCP clients still render nothing. So this returns the complete settings as ordinary
 * structured data. A host that supports MCP Apps additionally paints it; a host that does
 * not still lets the model read the rules aloud and change them by conversation.
 *
 * It deliberately overlaps `get_mail_policies` rather than replacing it. That tool is the
 * model's read path and its description is tuned for that; this one is the UI's entry
 * point. Splitting them keeps the app from being coupled to a description the model relies
 * on.
 */
export const settingsTools = [
  {
    name: "open_settings",
    description:
      "Shows the user their email rules, which preset is active, and whether mailbox changes are being applied for real or only simulated. Use when the user asks to see, review, or change their settings, rules, or preferences.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      authService.requirePrincipal(principal);
      authService.requireScope(principal, "profile.manage");

      const prefs = await userPreferencesService.getPreferences(principal);
      const policies = await policyService.getUserPolicies(principal);
      const rules = policies.filter((p) => p.enabled);

      return {
        activePreset: prefs.selectedPreset,
        dryRunEnabled: !config.MAILBOX_MUTATIONS_ENABLED,
        ruleCount: rules.length,
        rules: rules.map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope,
          action: r.action,
          destination: r.destination ?? null,
          enabled: r.enabled,
        })),
      };
    },
  },
];
