import { describe, it, expect, beforeEach } from "bun:test";
import { db, schema } from "../src/db";
import { nanoid } from "nanoid";
import { providerFactory } from "../src/providers/factory";
import { encryptionService } from "../src/services/encryption";
import { authService } from "../src/services/auth";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { AccountOwnershipError } from "../src/utils/errors";

describe("Provider-Neutral Architecture & Tenant Isolation", () => {
  let tenantA: { tenantId: string; userId: string; token: string };
  let tenantB: { tenantId: string; userId: string; token: string };
  let principalA: AuthPrincipal;
  let principalB: AuthPrincipal;

  beforeEach(async () => {
    const idA = nanoid();
    tenantA = await authService.createTenantAndOwner({
      tenantName: `Tenant Alpha ${idA}`,
      slug: `tenant-alpha-${idA}`,
      ownerEmail: `alice-${idA}@example.com`,
      ownerDisplayName: "Alice Alpha",
    });
    principalA = {
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      scopes: ALL_SCOPES,
      email: `alice-${idA}@example.com`,
    };

    const idB = nanoid();
    tenantB = await authService.createTenantAndOwner({
      tenantName: `Tenant Beta ${idB}`,
      slug: `tenant-beta-${idB}`,
      ownerEmail: `bob-${idB}@example.com`,
      ownerDisplayName: "Bob Beta",
    });
    principalB = {
      tenantId: tenantB.tenantId,
      userId: tenantB.userId,
      scopes: ALL_SCOPES,
      email: `bob-${idB}@example.com`,
    };
  });

  it("instantiates an ImapProvider when account provider is imap", async () => {
    const now = new Date();
    const accountId = "acc_imap_" + nanoid();

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      provider: "imap",
      displayName: "Alice Company Email",
      emailAddress: "alice@company.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    const imapCreds = {
      emailAddress: "alice@company.com",
      imap: {
        host: "mail.company.com",
        port: 993,
        secure: true,
        username: "alice@company.com",
        password: "secret_password",
      },
    };

    const encryptedCredentials = encryptionService.encryptJson(imapCreds, {
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
    });

    await db.insert(schema.providerConnections).values({
      id: nanoid(),
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      accountId,
      provider: "imap",
      encryptedCredentials,
      keyVersion: encryptedCredentials.keyVersion,
      createdAt: now,
      updatedAt: now,
    });

    const provider = await providerFactory.getProviderForAccount(principalA, accountId);
    expect(provider).toBeDefined();
    expect(provider.provider).toBe("imap");
    expect(provider.getCapabilities?.().folders).toBe(true);
  });

  it("strictly prevents cross-workspace tenant access to mail providers", async () => {
    const now = new Date();
    const accountIdA = "acc_imap_a_" + nanoid();

    await db.insert(schema.emailAccounts).values({
      id: accountIdA,
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      provider: "imap",
      displayName: "Alice Private Mail",
      emailAddress: "alice@private.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    const encryptedCredentials = encryptionService.encryptJson(
      { emailAddress: "alice@private.com", imap: { host: "mail.private.com", port: 993, username: "alice" } },
      { tenantId: tenantA.tenantId, userId: tenantA.userId }
    );

    await db.insert(schema.providerConnections).values({
      id: nanoid(),
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      accountId: accountIdA,
      provider: "imap",
      encryptedCredentials,
      keyVersion: encryptedCredentials.keyVersion,
      createdAt: now,
      updatedAt: now,
    });

    // Principal B tries to access Account A belonging to Tenant A
    await expect(providerFactory.getProviderForAccount(principalB, accountIdA)).rejects.toThrow(
      AccountOwnershipError
    );
  });

  it("returns mock provider for test / development environments", async () => {
    const mockProvider = providerFactory.getMockProvider();
    expect(mockProvider.provider).toBe("mock");
  });
});
