import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import { authService } from "./auth";
import { auditService } from "./audit";
import { NotFoundError, AccountOwnershipError } from "../utils/errors";

export class PrivacyService {
  /**
   * Lists all connected accounts and their configuration for the user
   */
  async listAccounts(principal: AuthPrincipal) {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "accounts.read");

    return db
      .select({
        id: schema.emailAccounts.id,
        displayName: schema.emailAccounts.displayName,
        emailAddress: schema.emailAccounts.emailAddress,
        provider: schema.emailAccounts.provider,
        status: schema.emailAccounts.status,
        priorityRole: schema.emailAccounts.priorityRole,
        lastSyncedAt: schema.emailAccounts.lastSyncedAt,
        createdAt: schema.emailAccounts.createdAt,
      })
      .from(schema.emailAccounts)
      .where(
        and(
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        )
      );
  }

  /**
   * Disconnects an account: stops ingestion, purges encrypted credentials, updates status
   */
  async disconnectAccount(principal: AuthPrincipal, accountId: string): Promise<void> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "accounts.manage");

    const [account] = await db
      .select()
      .from(schema.emailAccounts)
      .where(
        and(
          eq(schema.emailAccounts.id, accountId),
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        )
      )
      .limit(1);

    if (!account) {
      throw new AccountOwnershipError(`Account '${accountId}' not found or unauthorized`);
    }

    // Delete credentials permanently
    await db
      .delete(schema.providerConnections)
      .where(
        and(
          eq(schema.providerConnections.accountId, accountId),
          eq(schema.providerConnections.tenantId, principal.tenantId),
          eq(schema.providerConnections.userId, principal.userId)
        )
      );

    // Update account status to disconnected
    await db
      .update(schema.emailAccounts)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(schema.emailAccounts.id, accountId));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PROVIDER_DISCONNECT",
      resourceType: "account",
      resourceId: accountId,
      details: { emailAddress: account.emailAddress, provider: account.provider },
    });
  }

  /**
   * Purges cached email body content from database
   */
  async deleteCachedEmailBodies(principal: AuthPrincipal): Promise<{ count: number }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.manage");

    await db
      .update(schema.emails)
      .set({
        textBody: "[Content purged by user privacy request]",
        htmlBody: null,
        snippet: "[Content purged]",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.emails.tenantId, principal.tenantId),
          eq(schema.emails.userId, principal.userId)
        )
      );

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PRIVACY_CACHE_PURGE",
      resourceType: "email",
    });

    return { count: 1 };
  }

  /**
   * Purges all learned sender profiles and relationship memories
   */
  async deleteSenderMemory(principal: AuthPrincipal): Promise<void> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "relationships.manage");

    await db
      .delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.tenantId, principal.tenantId),
          eq(schema.relationships.userId, principal.userId)
        )
      );

    await db
      .delete(schema.senderProfiles)
      .where(
        and(
          eq(schema.senderProfiles.tenantId, principal.tenantId),
          eq(schema.senderProfiles.userId, principal.userId)
        )
      );

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PRIVACY_CACHE_PURGE",
      resourceType: "sender_memory",
    });
  }

  /**
   * Exports all user data into a portable JSON structure (LGPD/GDPR readiness)
   */
  async exportUserData(principal: AuthPrincipal): Promise<Record<string, any>> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "profile.read");

    const [user] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, principal.userId), eq(schema.users.tenantId, principal.tenantId)));

    const accounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(and(eq(schema.emailAccounts.userId, principal.userId), eq(schema.emailAccounts.tenantId, principal.tenantId)));

    const emails = await db
      .select()
      .from(schema.emails)
      .where(and(eq(schema.emails.userId, principal.userId), eq(schema.emails.tenantId, principal.tenantId)));

    const senders = await db
      .select()
      .from(schema.senderProfiles)
      .where(and(eq(schema.senderProfiles.userId, principal.userId), eq(schema.senderProfiles.tenantId, principal.tenantId)));

    const rels = await db
      .select()
      .from(schema.relationships)
      .where(and(eq(schema.relationships.userId, principal.userId), eq(schema.relationships.tenantId, principal.tenantId)));

    const drafts = await db
      .select()
      .from(schema.drafts)
      .where(and(eq(schema.drafts.userId, principal.userId), eq(schema.drafts.tenantId, principal.tenantId)));

    const signatures = await db
      .select()
      .from(schema.signatureProfiles)
      .where(and(eq(schema.signatureProfiles.userId, principal.userId), eq(schema.signatureProfiles.tenantId, principal.tenantId)));

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.userId, principal.userId), eq(schema.auditEvents.tenantId, principal.tenantId)));

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PRIVACY_DATA_EXPORT",
      resourceType: "user",
      resourceId: principal.userId,
    });

    return {
      exportedAt: new Date().toISOString(),
      user,
      accounts: accounts.map((a: any) => ({ ...a, syncCursor: undefined })),
      emails,
      senderProfiles: senders,
      relationships: rels,
      drafts,
      signatureProfiles: signatures,
      auditHistory: audits,
    };
  }
}

export const privacyService = new PrivacyService();
