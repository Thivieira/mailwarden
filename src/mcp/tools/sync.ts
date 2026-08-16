import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { authService } from "../../services/auth";
import { syncService } from "../../services/sync";

export const syncTools = [
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
