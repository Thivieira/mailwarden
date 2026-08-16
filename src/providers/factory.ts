import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type { MailProvider } from "./types";
import { MockMailProvider } from "./mock";
import { GmailProvider, type GmailCredentials } from "./gmail";
import { OutlookProvider, type OutlookCredentials } from "./outlook";
import { ProtonBridgeProvider, type ProtonBridgeCredentials } from "./proton";
import { encryptionService } from "../services/encryption";
import { AccountOwnershipError, NotFoundError } from "../utils/errors";

export class ProviderFactory {
  private mockProviderInstance: MockMailProvider = new MockMailProvider();

  /**
   * Resolves and initializes the provider adapter for a connected account
   */
  async getProviderForAccount(principal: AuthPrincipal, accountId: string): Promise<MailProvider> {
    // 1. Verify account exists and belongs to authenticated tenant & user
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
      throw new AccountOwnershipError(
        `Email account '${accountId}' was not found or does not belong to your user account`
      );
    }

    if (account.provider === "mock") {
      return this.mockProviderInstance;
    }

    // 2. Fetch encrypted credentials
    const [conn] = await db
      .select()
      .from(schema.providerConnections)
      .where(
        and(
          eq(schema.providerConnections.accountId, accountId),
          eq(schema.providerConnections.tenantId, principal.tenantId),
          eq(schema.providerConnections.userId, principal.userId)
        )
      )
      .limit(1);

    if (!conn) {
      // If no credentials yet but account exists (e.g. testing / offline), return mock provider
      return this.mockProviderInstance;
    }

    // 3. Decrypt credentials using envelope encryption service with strict tenant/user derivation context
    const decryptedCreds = encryptionService.decryptJson<any>(conn.encryptedCredentials as any, {
      tenantId: principal.tenantId,
      userId: principal.userId,
    });

    // 4. Instantiate provider adapter
    switch (account.provider) {
      case "gmail":
        return new GmailProvider(decryptedCreds as GmailCredentials);
      case "outlook":
        return new OutlookProvider(decryptedCreds as OutlookCredentials);
      case "proton":
        return new ProtonBridgeProvider(decryptedCreds as ProtonBridgeCredentials);
      default:
        return this.mockProviderInstance;
    }
  }

  getMockProvider(): MockMailProvider {
    return this.mockProviderInstance;
  }
}

export const providerFactory = new ProviderFactory();
