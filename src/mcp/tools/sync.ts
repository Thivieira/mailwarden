import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { authService } from "../../services/auth";
import { syncService } from "../../services/sync";
import { providerOAuthService } from "../../services/provider-oauth";

export const syncTools = [
  {
    name: "get_email_connection_url",
    description: "Starts a Gmail or Outlook connection for the authenticated user and returns the provider authorization URL. Use when the user asks to connect one of these email accounts.",
    parameters: z.object({
      provider: z.enum(["gmail", "outlook"]),
      mode: z.enum(["readonly", "actions", "draft", "full"]).default("full").describe("Connection capability. Use full only when the user wants drafting/sending; readonly is enough for summaries."),
    }),
    handler: async (principal: AuthPrincipal, params: { provider: "gmail" | "outlook"; mode: "readonly" | "actions" | "draft" | "full" }) => {
      authService.requireScope(principal, "accounts.manage");
      const provider = params.provider === "gmail" ? "gmail" : "outlook";
      const result = await providerOAuthService.buildAuthorizationUrl(principal, provider, params.mode);
      return {
        provider: params.provider,
        mode: params.mode,
        authorizationUrl: result.authUrl,
        instruction: `Open this ${params.provider} authorization URL in your browser, approve access, then return here. Mailwarden will save the account and perform an initial sync automatically.`,
      };
    },
  },
  {
    name: "refresh_inboxes",
    description: "Refreshes all connected email accounts into Mailwarden before a current inbox summary. Use when the user asks about recent, new, today, current, or all email and the cache may be stale.",
    parameters: z.object({
      limitPerAccount: z.number().int().min(1).max(100).default(50).describe("Maximum recent messages to inspect per connected account"),
    }),
    handler: async (principal: AuthPrincipal, params: { limitPerAccount: number }) => {
      authService.requireScope(principal, "accounts.manage");
      return syncService.syncAll(principal, params.limitPerAccount);
    },
  },
];
