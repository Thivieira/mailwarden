import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { privacyService } from "../../services/privacy";

export const privacyTools = [
  {
    name: "list_accounts",
    description: "Lists all connected email accounts and their active status.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      const accounts = await privacyService.listAccounts(principal);
      return { accounts };
    },
  },
  {
    name: "disconnect_account",
    description: "Disconnects an email provider account and permanently removes stored credentials.",
    parameters: z.object({
      accountId: z.string().describe("The account ID to disconnect"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string }) => {
      await privacyService.disconnectAccount(principal, params.accountId);
      return {
        success: true,
        accountId: params.accountId,
        message: "Account disconnected and credentials purged.",
      };
    },
  },
  {
    name: "list_permissions",
    description: "Lists the active scopes granted to the current MCP session.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      return {
        tenantId: principal.tenantId,
        userId: principal.userId,
        grantedScopes: principal.scopes,
      };
    },
  },
];
