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
import { organizationService } from "../services/organizations";

export class ProviderFactory {
  private mockProviderInstance: MockMailProvider = new MockMailProvider();

  async getProviderForAccount(principal: AuthPrincipal, accountId: string): Promise<MailProvider> {
    await organizationService.requireWorkspaceMembership(principal, principal.tenantId);
    const [account] = await db.select().from(schema.emailAccounts).where(and(
      eq(schema.emailAccounts.id, accountId),
      eq(schema.emailAccounts.tenantId, principal.tenantId)
    )).limit(1);

    if (!account) {
      throw new AccountOwnershipError(`Email account '${accountId}' was not found or does not belong to your user account`);
    }

    if (account.provider === "mock") return this.mockProviderInstance;

    const [conn] = await db.select().from(schema.providerConnections).where(and(
      eq(schema.providerConnections.accountId, accountId),
      eq(schema.providerConnections.tenantId, principal.tenantId),
      eq(schema.providerConnections.userId, account.userId)
    )).limit(1);

    if (!conn) {
      throw new NotFoundError("Provider credentials for email account", accountId);
    }
    if (conn.provider !== account.provider) {
      throw new AccountOwnershipError(`Provider connection mismatch for account '${accountId}'`);
    }

    const decryptedCreds = encryptionService.decryptJson<any>(conn.encryptedCredentials as any, {
      tenantId: principal.tenantId,
      userId: account.userId,
    });

    switch (account.provider) {
      case "gmail":
        return new GmailProvider(decryptedCreds as GmailCredentials);
      case "outlook":
        return new OutlookProvider(decryptedCreds as OutlookCredentials);
      case "proton": {
        const creds = decryptedCreds as ProtonBridgeCredentials;
        // A registered relay supersedes whatever the mailbox was configured with:
        // its per-device secret lets Cloud sign the request, and its endpoint is
        // the tunnel Mailwarden manages.
        const { relayDeviceService } = await import("../services/relay-devices");
        const relay = await relayDeviceService.resolveWorkspaceRelay(principal.tenantId).catch(() => null);
        if (relay) {
          return new ProtonBridgeProvider({
            ...creds,
            mode: "gateway",
            gatewayUrl: `${relay.endpoint.replace(/\/+$/, "")}/v1`,
            deviceGatewaySecret: relay.gatewaySecret,
            relayDeviceId: relay.deviceId,
          });
        }
        return new ProtonBridgeProvider(creds);
      }
      default:
        throw new NotFoundError("Supported provider adapter", account.provider);
    }
  }

  getMockProvider(): MockMailProvider {
    return this.mockProviderInstance;
  }
}

export const providerFactory = new ProviderFactory();
