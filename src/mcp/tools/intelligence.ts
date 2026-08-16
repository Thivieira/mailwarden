import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { intelligenceService } from "../../services/intelligence";
import { relationshipService } from "../../services/relationships";
import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { authService } from "../../services/auth";
import { auditService } from "../../services/audit";
import { nanoid } from "nanoid";

export const intelligenceTools = [
  {
    name: "correct_classification",
    description: "Explicitly updates or corrects the stored classification of an email (importance, workflow state, category, summary).",
    parameters: z.object({
      emailId: z.string().describe("The internal message ID to correct"),
      importance: z.enum(["critical", "high", "normal", "low"]).optional().describe("Importance level"),
      category: z.enum([
        "work",
        "client",
        "recruiter",
        "legal",
        "financial",
        "security",
        "personal",
        "newsletter",
        "marketing",
        "transactional",
        "automated",
        "junk",
        "other",
      ]).optional().describe("Semantic category"),
      workflowState: z.enum([
        "action_required",
        "waiting_for_reply",
        "follow_up",
        "fyi",
        "news",
        "automated",
        "junk",
      ]).optional().describe("Workflow state"),
      summary: z.string().optional().describe("Updated summary of message meaning"),
      reason: z.string().optional().describe("Explanation for correction"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      authService.requireScope(principal, "profile.manage");
      const result = await intelligenceService.correctClassification(principal, params);
      return { success: true, classification: result };
    },
  },
  {
    name: "set_sender_relationship",
    description: "Explicitly registers or updates a sender's relationship type (e.g. client, coworker, recruiter, vendor).",
    parameters: z.object({
      emailAddress: z.string().email().describe("The sender email address"),
      type: z.enum([
        "client",
        "coworker",
        "employer",
        "lead",
        "recruiter",
        "vendor",
        "service",
        "personal",
        "unknown",
      ]).describe("Relationship type"),
      organizationName: z.string().optional().describe("Associated company or organization name"),
      notes: z.string().optional().describe("Context notes regarding relationship"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      const rel = await relationshipService.setSenderRelationship(principal, params);
      return { success: true, relationship: rel };
    },
  },
  {
    name: "associate_sender_with_project",
    description: "Links a sender contact with an active project name.",
    parameters: z.object({
      emailAddress: z.string().email().describe("The sender email address"),
      projectName: z.string().describe("The project name to associate with"),
    }),
    handler: async (principal: AuthPrincipal, params: { emailAddress: string; projectName: string }) => {
      await relationshipService.associateSenderWithProject(principal, params.emailAddress, params.projectName);
      return { success: true, message: `Sender ${params.emailAddress} associated with project '${params.projectName}'` };
    },
  },
  {
    name: "set_account_priority",
    description: "Configures account level role and priority (e.g. primary_work, personal, freelance, entertainment, low_priority).",
    parameters: z.object({
      accountId: z.string().describe("The email account ID"),
      priorityRole: z.enum(["primary_work", "personal", "freelance", "entertainment", "low_priority"]).describe("Priority role"),
    }),
    handler: async (principal: AuthPrincipal, params: { accountId: string; priorityRole: any }) => {
      authService.requireScope(principal, "accounts.manage");
      await db
        .update(schema.emailAccounts)
        .set({ priorityRole: params.priorityRole, updatedAt: new Date() })
        .where(
          and(
            eq(schema.emailAccounts.id, params.accountId),
            eq(schema.emailAccounts.tenantId, principal.tenantId),
            eq(schema.emailAccounts.userId, principal.userId)
          )
        );

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "ACCOUNT_PRIORITY_UPDATE",
        resourceType: "account",
        resourceId: params.accountId,
        details: { priorityRole: params.priorityRole },
      });

      return { success: true, accountId: params.accountId, priorityRole: params.priorityRole };
    },
  },
  {
    name: "set_thread_state",
    description: "Updates manual thread summary or open loops for a conversation thread.",
    parameters: z.object({
      accountId: z.string().describe("Account ID"),
      threadId: z.string().describe("Provider thread ID"),
      summary: z.string().optional().describe("Summary of thread state"),
      openLoops: z.array(
        z.object({
          type: z.enum(["user_owes_reply", "other_party_owes_reply", "pending_action", "pending_decision"]),
          description: z.string(),
        })
      ).optional().describe("List of pending open loops"),
    }),
    handler: async (principal: AuthPrincipal, params: any) => {
      authService.requireScope(principal, "mail.modify");
      const [existing] = await db
        .select()
        .from(schema.threadStates)
        .where(
          and(
            eq(schema.threadStates.tenantId, principal.tenantId),
            eq(schema.threadStates.userId, principal.userId),
            eq(schema.threadStates.accountId, params.accountId),
            eq(schema.threadStates.providerThreadId, params.threadId)
          )
        )
        .limit(1);

      const now = new Date();
      if (existing) {
        await db
          .update(schema.threadStates)
          .set({
            summary: params.summary || existing.summary,
            openLoops: params.openLoops
              ? params.openLoops.map((l: any) => ({ id: nanoid(), ...l, resolved: false }))
              : existing.openLoops,
            updatedAt: now,
          })
          .where(eq(schema.threadStates.id, existing.id));
      }

      return { success: true, threadId: params.threadId };
    },
  },
];
