import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { attentionService } from "../../services/attention";
import { emailService } from "../../services/email";
import { relationshipService } from "../../services/relationships";
import { privacyService } from "../../services/privacy";

export const readTools = [
  {
    name: "get_inbox_status",
    description: "Summarizes cross-account inbox state without downloading entire mailboxes. Returns totals for unread, action required, waiting for reply, top attention items, and account health.",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      const summary = await attentionService.getInboxStatus(principal);
      return summary;
    },
  },
  {
    name: "get_attention_queue",
    description: "Returns the prioritized candidates for user attention ranked by relationship importance, deadlines, open loops, and factual signals.",
    parameters: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of attention candidates to return"),
      minScore: z.number().int().min(0).max(100).default(30).describe("Minimum attention score threshold"),
    }),
    handler: async (principal: AuthPrincipal, params: { limit: number; minScore: number }) => {
      const items = await attentionService.getAttentionQueue(principal, params);
      return { count: items.length, items };
    },
  },
  {
    name: "get_account_status",
    description: "Returns the connection and sync status of all connected email accounts (Gmail, Outlook, Proton).",
    parameters: z.object({}),
    handler: async (principal: AuthPrincipal) => {
      const accounts = await privacyService.listAccounts(principal);
      return { accounts };
    },
  },
  {
    name: "get_message",
    description: "Retrieves a single normalized email message with sanitized text, headers, and metadata.",
    parameters: z.object({
      messageId: z.string().describe("The internal message ID"),
    }),
    handler: async (principal: AuthPrincipal, params: { messageId: string }) => {
      const email = await emailService.getEmail(principal, params.messageId);
      return {
        id: email.id,
        accountId: email.accountId,
        provider: email.provider,
        providerMessageId: email.providerMessageId,
        providerThreadId: email.providerThreadId,
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        textBody: email.textBody,
        receivedAt: email.receivedAt.toISOString(),
        flags: email.flags,
        attachments: email.attachments,
      };
    },
  },
  {
    name: "get_thread",
    description: "Retrieves bounded conversation thread messages (default 5 recent messages) and thread state.",
    parameters: z.object({
      accountId: z.string().describe("The email account ID"),
      threadId: z.string().describe("The provider thread or conversation ID"),
      limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of recent messages to return"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string; threadId: string; limit: number }) => {
      const { threadState, messages } = await emailService.getThread(
        principal,
        params.accountId,
        params.threadId,
        params.limit
      );
      return {
        threadId: params.threadId,
        state: threadState,
        messageCount: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          from: m.from,
          to: m.to,
          subject: m.subject,
          textBody: m.textBody,
          receivedAt: m.receivedAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "search_mail",
    description: "Cross-account structured email search supporting sender, date range, project, unread status, or text queries.",
    parameters: z.object({
      query: z.string().optional().describe("Search keywords matching subject, body, or sender"),
      accountId: z.string().optional().describe("Filter by specific email account ID"),
      senderEmail: z.string().optional().describe("Filter by sender email address"),
      unreadOnly: z.boolean().optional().describe("Filter to unread messages only"),
      limit: z.number().int().min(1).max(50).default(20).describe("Maximum results to return"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const results = await emailService.searchMail(principal, params);
      return {
        total: results.total,
        messages: results.messages.map((m) => ({
          id: m.id,
          accountId: m.accountId,
          from: m.from,
          subject: m.subject,
          snippet: m.snippet,
          receivedAt: m.receivedAt.toISOString(),
          flags: m.flags,
        })),
      };
    },
  },
  {
    name: "get_sender_context",
    description: "Retrieves sender history, total messages seen, reply ratio, and inferred reply expectation.",
    parameters: z.object({
      emailAddress: z.string().email().describe("Sender email address to inspect"),
    }),
    handler: async (principal: AuthPrincipal, params: { emailAddress: string }) => {
      const profile = await relationshipService.getOrCreateSenderProfile(principal, params.emailAddress);
      return { senderProfile: profile };
    },
  },
  {
    name: "get_relationship_context",
    description: "Retrieves relationship profile (e.g. client, coworker, recruiter), associated organizations, and active projects.",
    parameters: z.object({
      emailAddress: z.string().email().describe("Email address to look up"),
    }),
    handler: async (principal: AuthPrincipal, params: { emailAddress: string }) => {
      return relationshipService.getRelationshipContext(principal, params.emailAddress);
    },
  },
  {
    name: "get_waiting_for_user",
    description: "Lists emails and threads where an action or reply is expected from the authenticated user.",
    parameters: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe("Max items to return"),
    }),
    handler: async (principal: AuthPrincipal, params: { limit: number }) => {
      const items = await attentionService.getWaitingForUser(principal, params.limit);
      return { count: items.length, items };
    },
  },
  {
    name: "get_user_waiting_for",
    description: "Lists threads where the user sent the last message and is awaiting a reply from an external party.",
    parameters: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe("Max items to return"),
    }),
    handler: async (principal: AuthPrincipal, params: { limit: number }) => {
      const threads = await attentionService.getUserWaitingFor(principal, params.limit);
      return { count: threads.length, threads };
    },
  },
];
