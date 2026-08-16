import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { emailService } from "../../services/email";

export const actionTools = [
  {
    name: "mark_read",
    description: "Marks an email message as read. (Respects dry-run mode if MAILBOX_MUTATIONS_ENABLED is false).",
    parameters: z.object({
      accountId: z.string().describe("The account ID"),
      messageId: z.string().describe("The message ID"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string; messageId: string }) => {
      const result = await emailService.mutateMailboxState(principal, params.accountId, params.messageId, "mark_read");
      return result;
    },
  },
  {
    name: "mark_unread",
    description: "Marks an email message as unread. (Respects dry-run mode if MAILBOX_MUTATIONS_ENABLED is false).",
    parameters: z.object({
      accountId: z.string().describe("The account ID"),
      messageId: z.string().describe("The message ID"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string; messageId: string }) => {
      const result = await emailService.mutateMailboxState(principal, params.accountId, params.messageId, "mark_unread");
      return result;
    },
  },
  {
    name: "archive",
    description: "Archives an email message from the inbox. (Respects dry-run mode if MAILBOX_MUTATIONS_ENABLED is false).",
    parameters: z.object({
      accountId: z.string().describe("The account ID"),
      messageId: z.string().describe("The message ID"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string; messageId: string }) => {
      const result = await emailService.mutateMailboxState(principal, params.accountId, params.messageId, "archive");
      return result;
    },
  },
];
