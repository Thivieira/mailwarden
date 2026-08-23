import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { ALL_SCOPES, type AuthPrincipal } from "../types/auth";
import { AccountOwnershipError } from "../utils/errors";
import { logger } from "../utils/logger";
import { providerFactory } from "../providers/factory";
import { emailService } from "./email";
import { auditService } from "./audit";

export class SyncService {
  async syncAccount(principal: AuthPrincipal, accountId: string, limit = 25) {
    const [account] = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.id, accountId),
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId)
    )).limit(1);

    if (!account) throw new AccountOwnershipError(`Account '${accountId}' not found or unauthorized`);
    if (account.status === "disconnected") throw new AccountOwnershipError(`Account '${accountId}' is disconnected`);

    const provider = await providerFactory.getProviderForAccount(principal, accountId);
    const startedAt = Date.now();
    const maxWanted = Math.min(Math.max(limit, 1), 25);
    let ingested = 0;
    let skipped = 0;
    let fetched = 0;

    try {
      const result = await provider.search(principal, accountId, { limit: maxWanted });
      const totalEstimated = result.totalEstimated;

      for (const message of result.messages) {
        fetched += 1;
        try {
          const {
            id: _id,
            tenantId: _tenantId,
            userId: _userId,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            ...input
          } = message as any;
          await emailService.ingestEmail(principal, input);
          ingested += 1;
        } catch (error: any) {
          skipped += 1;
          logger.warn("Message ingestion failed during provider sync", {
            accountId,
            provider: account.provider,
            providerMessageId: message.providerMessageId,
            error: error.message,
          });
        }
      }

      await db.update(schema.emailAccounts).set({
        status: "connected",
        errorMessage: null,
        lastSyncedAt: new Date(),
        syncCursor: result.nextPageToken || null,
        updatedAt: new Date(),
      }).where(eq(schema.emailAccounts.id, accountId));

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "PROVIDER_SYNC",
        resourceType: "account",
        resourceId: accountId,
        details: { provider: account.provider, ingested, skipped, fetched, durationMs: Date.now() - startedAt },
      });

      return {
        accountId,
        provider: account.provider,
        emailAddress: account.emailAddress,
        status: "connected",
        ingested,
        skipped,
        fetched,
        totalEstimated,
        syncedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      await db.update(schema.emailAccounts).set({
        status: "error",
        errorMessage: error.message,
        updatedAt: new Date(),
      }).where(eq(schema.emailAccounts.id, accountId));

      await auditService.logEvent({
        tenantId: principal.tenantId,
        userId: principal.userId,
        action: "PROVIDER_SYNC",
        resourceType: "account",
        resourceId: accountId,
        status: "failure",
        details: { provider: account.provider, error: error.message },
      });
      throw error;
    }
  }

  async syncAll(principal: AuthPrincipal, limitPerAccount = 50) {
    const accounts = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.tenantId, principal.tenantId),
      eq(schema.emailAccounts.userId, principal.userId),
      eq(schema.emailAccounts.status, "connected")
    ));

    const results = [] as any[];
    for (const account of accounts) {
      try {
        results.push({ ok: true, ...(await this.syncAccount(principal, account.id, limitPerAccount)) });
      } catch (error: any) {
        results.push({ ok: false, accountId: account.id, provider: account.provider, error: error.message });
      }
    }
    return { accounts: results, syncedAccounts: results.filter((x) => x.ok).length };
  }

  async syncAllConnectedAccounts(limitPerAccount = 25) {
    const accounts = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.status, "connected"));
    const results = [] as any[];

    for (const account of accounts) {
      const principal: AuthPrincipal = {
        tenantId: account.tenantId,
        userId: account.userId,
        scopes: ALL_SCOPES,
      };
      try {
        results.push({ ok: true, ...(await this.syncAccount(principal, account.id, limitPerAccount)) });
      } catch (error: any) {
        results.push({ ok: false, accountId: account.id, provider: account.provider, error: error.message });
      }
    }

    return results;
  }
}

export const syncService = new SyncService();
