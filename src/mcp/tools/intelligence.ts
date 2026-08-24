import { z } from "zod";
import type { AuthPrincipal } from "../../types/auth";
import { relationshipService } from "../../services/relationships";
import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { authService } from "../../services/auth";
import { auditService } from "../../services/audit";
import { ValidationError } from "../../utils/errors";
import { nanoid } from "nanoid";

async function resolveOwnedAccount(
  principal: AuthPrincipal,
  params: { accountId?: string; emailAddress?: string }
) {
  if (!params.accountId && !params.emailAddress) {
    throw new ValidationError("Specify accountId or emailAddress");
  }

  const conditions = [
    eq(schema.emailAccounts.tenantId, principal.tenantId),
    eq(schema.emailAccounts.userId, principal.userId),
  ];

  if (params.accountId) conditions.push(eq(schema.emailAccounts.id, params.accountId));
  if (params.emailAddress) conditions.push(eq(schema.emailAccounts.emailAddress, params.emailAddress.toLowerCase()));

  const [account] = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(...conditions))
    .limit(1);

  if (!account) throw new ValidationError("No connected email account matched that address or account ID");
  return account;
}

export const intelligenceTools = [
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
    description: "Configures a connected email account's role/priority. The account can be identified by its email address so users do not need internal IDs.",
    parameters: z.object({
      accountId: z.string().optional().describe("Optional internal email account ID"),
      emailAddress: z.string().email().optional().describe("Human-friendly connected email address"),
      priorityRole: z.enum(["primary_work", "personal", "freelance", "entertainment", "low_priority"]).describe("Priority role"),
    }).refine((value) => Boolean(value.accountId || value.emailAddress), {
      message: "accountId or emailAddress is required",
    }),
    handler: async (principal: AuthPrincipal, params: { accountId?: string; emailAddress?: string; priorityRole: any }) => {
      authService.requireScope(principal, "accounts.manage");
      const account = await resolveOwnedAccount(principal, params);

      await db
        .update(schema.emailAccounts)
        .set({ priorityRole: params.priorityRole, updatedAt: new Date() })
        .where(and(
          eq(schema.emailAccounts.id, account.id),
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        ));

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "ACCOUNT_PRIORITY_UPDATE",
        resourceType: "account",
        resourceId: account.id,
        details: { emailAddress: account.emailAddress, priorityRole: params.priorityRole },
      });

      return {
        success: true,
        accountId: account.id,
        emailAddress: account.emailAddress,
        displayName: account.displayName,
        priorityRole: params.priorityRole,
      };
    },
  },
  {
    name: "set_account_profile",
    description: "Sets a friendly label and/or role for one of the user's connected email accounts. Use for requests like 'call this my Personal Gmail' or 'this Outlook is my work account'.",
    parameters: z.object({
      accountId: z.string().optional().describe("Optional internal account ID"),
      emailAddress: z.string().email().optional().describe("Connected account email address"),
      label: z.string().min(1).max(80).optional().describe("Friendly user-facing label, e.g. Personal Gmail, Consulting, Main Work"),
      priorityRole: z.enum(["primary_work", "personal", "freelance", "entertainment", "low_priority"]).optional(),
    }).refine((value) => Boolean(value.accountId || value.emailAddress), {
      message: "accountId or emailAddress is required",
    }).refine((value) => Boolean(value.label || value.priorityRole), {
      message: "label or priorityRole is required",
    }),
    handler: async (principal: AuthPrincipal, params: { accountId?: string; emailAddress?: string; label?: string; priorityRole?: any }) => {
      authService.requireScope(principal, "accounts.manage");
      const account = await resolveOwnedAccount(principal, params);
      const updates: any = { updatedAt: new Date() };
      if (params.label) updates.displayName = params.label.trim();
      if (params.priorityRole) updates.priorityRole = params.priorityRole;

      await db
        .update(schema.emailAccounts)
        .set(updates)
        .where(and(
          eq(schema.emailAccounts.id, account.id),
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        ));

      if (params.priorityRole) {
        await auditService.logEvent({
          tenantId: principal.tenantId,
          userId: principal.userId,
          action: "ACCOUNT_PRIORITY_UPDATE",
          resourceType: "account",
          resourceId: account.id,
          details: {
            emailAddress: account.emailAddress,
            label: params.label,
            priorityRole: params.priorityRole,
          },
        });
      }

      return {
        success: true,
        accountId: account.id,
        emailAddress: account.emailAddress,
        label: params.label || account.displayName,
        priorityRole: params.priorityRole || account.priorityRole,
      };
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
        .where(and(
          eq(schema.threadStates.tenantId, principal.tenantId),
          eq(schema.threadStates.userId, principal.userId),
          eq(schema.threadStates.accountId, params.accountId),
          eq(schema.threadStates.providerThreadId, params.threadId)
        ))
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
