import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { protonConnectorService } from "../src/services/proton-connector";
import { attentionService } from "../src/services/attention";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Proton Connector & Cross-Account Provider Status", () => {
  let principal: AuthPrincipal;
  let otherPrincipal: AuthPrincipal;
  let protonAccountId: string;
  let gmailAccountId: string;
  let otherProtonAccountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Proton Org ${id}`,
      slug: `proton-org-${id}`,
      ownerEmail: `user-${id}@example.com`,
      ownerDisplayName: "Proton Owner",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
    };

    const otherId = nanoid();
    const otherCreated = await authService.createTenantAndOwner({
      tenantName: `Other Proton Org ${otherId}`,
      slug: `other-proton-org-${otherId}`,
      ownerEmail: `other-${otherId}@example.com`,
      ownerDisplayName: "Other Owner",
    });

    otherPrincipal = {
      tenantId: otherCreated.tenantId,
      userId: otherCreated.userId,
      scopes: ALL_SCOPES,
    };

    const now = new Date();

    // User's Gmail account
    gmailAccountId = nanoid();
    await db.insert(schema.emailAccounts).values({
      id: gmailAccountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "gmail",
      displayName: "Work Gmail",
      emailAddress: `work-${id}@gmail.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    // User's Proton account
    protonAccountId = nanoid();
    await db.insert(schema.emailAccounts).values({
      id: protonAccountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "proton",
      displayName: "Secure Proton",
      emailAddress: `secure-${id}@proton.me`,
      status: "connected",
      priorityRole: "personal",
      createdAt: now,
      updatedAt: now,
    });

    // Other user's Proton account
    otherProtonAccountId = nanoid();
    await db.insert(schema.emailAccounts).values({
      id: otherProtonAccountId,
      tenantId: otherPrincipal.tenantId,
      userId: otherPrincipal.userId,
      provider: "proton",
      displayName: "Other Secure Proton",
      emailAddress: `other-secure-${otherId}@proton.me`,
      status: "connected",
      priorityRole: "personal",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Registers a local Proton connector and updates heartbeat", async () => {
    const registration = await protonConnectorService.registerConnector(principal, {
      accountId: protonAccountId,
      deviceName: "Thiago-PC",
      connectorType: "local_connector",
      bridgeHost: "127.0.0.1",
      bridgeImapPort: 1143,
      bridgeSmtpPort: 1025,
    });

    expect(registration.connector).toBeDefined();
    expect(registration.connector.deviceName).toBe("Thiago-PC");
    expect(registration.connector.status).toBe("online");
    expect(registration.rawDeviceToken).toBeDefined();
    expect(registration.rawDeviceToken.startsWith("mwp_")).toBe(true);

    // Perform heartbeat with the raw token
    const heartbeatResult = await protonConnectorService.processHeartbeat(registration.rawDeviceToken, {
      status: "online",
    });

    expect(heartbeatResult.success).toBe(true);
    expect(heartbeatResult.accountId).toBe(protonAccountId);
  });

  it("Reflects incomplete cross-account state and warnings when Proton connector is offline", async () => {
    // Register connector but simulate stale lastSeenAt (6 minutes ago)
    const registration = await protonConnectorService.registerConnector(principal, {
      accountId: protonAccountId,
      deviceName: "Thiago-PC",
    });

    // Stale timestamp (6 minutes ago)
    const staleTime = new Date(Date.now() - 6 * 60 * 1000);
    await db
      .update(schema.protonConnectors)
      .set({ lastSeenAt: staleTime, status: "online" })
      .where(eq(schema.protonConnectors.id, registration.connector.id));

    const statusSummary = await attentionService.getInboxStatus(principal);
    expect(statusSummary.providerWarnings).toBeDefined();
    expect(statusSummary.providerWarnings!.length).toBeGreaterThan(0);
    // Assert the guarantee, not the wording: the warning must name the provider, say it
    // is offline, and admit the results are incomplete. Pinning exact prose meant an
    // ordinary copy edit broke this test without changing the behaviour it protects.
    const warning = statusSummary.providerWarnings![0]!;
    expect(warning).toMatch(/proton/i);
    expect(warning).toMatch(/offline/i);
    expect(warning).toMatch(/incomplete/i);

    const protonAcc = statusSummary.accounts.find((a) => a.provider === "proton");
    expect(protonAcc!.status).toBe("offline");
  });

  it("Enforces tenant isolation on Proton connectors", async () => {
    const registration = await protonConnectorService.registerConnector(principal, {
      accountId: protonAccountId,
      deviceName: "Thiago-PC",
    });

    // Other user cannot query this connector
    const otherQuery = await protonConnectorService.getConnectorByAccountId(
      otherPrincipal,
      protonAccountId
    );
    expect(otherQuery).toBeNull();

    // Other user cannot register a connector targeting this user's account
    expect(
      protonConnectorService.registerConnector(otherPrincipal, {
        accountId: protonAccountId,
        deviceName: "Hacker-PC",
      })
    ).rejects.toThrow();
  });
});
