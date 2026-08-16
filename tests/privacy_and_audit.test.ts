import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { privacyService } from "../src/services/privacy";
import { emailService } from "../src/services/email";
import { relationshipService } from "../src/services/relationships";
import { auditService } from "../src/services/audit";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Privacy Controls & Audit Trail", () => {
  let principal: AuthPrincipal;
  let accountId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Privacy Org ${id}`,
      slug: `privacy-org-${id}`,
      ownerEmail: `privacy-${id}@company.com`,
      ownerDisplayName: "Privacy User",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      email: `privacy-${id}@company.com`,
    };

    accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Privacy Mailbox",
      emailAddress: "privacy@company.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Exports comprehensive portable JSON data", async () => {
    await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_p1_${nanoid()}`,
      from: { address: "client@test.com" },
      to: [{ address: "privacy@company.com" }],
      cc: [],
      bcc: [],
      subject: "Export Test",
      textBody: "Exportable content",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    const exportData = await privacyService.exportUserData(principal);
    expect(exportData.exportedAt).toBeDefined();
    expect(exportData.user.email).toBe(principal.email!.toLowerCase());
    expect(exportData.emails.length).toBeGreaterThan(0);
    expect(exportData.auditHistory.length).toBeGreaterThan(0);
  });

  it("Purges raw email bodies from database while preserving metadata", async () => {
    const email = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: `msg_purge_${nanoid()}`,
      from: { address: "client@test.com" },
      to: [{ address: "privacy@company.com" }],
      cc: [],
      bcc: [],
      subject: "Sensitive Secret Email",
      textBody: "Extremely sensitive personal private body content",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    await privacyService.deleteCachedEmailBodies(principal);

    const fetched = await emailService.getEmail(principal, email.id);
    expect(fetched.textBody).toContain("[Content purged");
    expect(fetched.subject).toBe("Sensitive Secret Email"); // Metadata retained
  });

  it("Disconnecting account purges credentials permanently and writes audit log", async () => {
    // Insert mock encrypted credential
    await db.insert(schema.providerConnections).values({
      id: nanoid(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      provider: "mock",
      encryptedCredentials: {
        encryptedData: "abc",
        iv: "123",
        tag: "456",
        keyVersion: "v1",
      },
      keyVersion: "v1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await privacyService.disconnectAccount(principal, accountId);

    // Verify credentials row is deleted
    const conns = await db
      .select()
      .from(schema.providerConnections)
      .where(eq(schema.providerConnections.accountId, accountId));
    expect(conns.length).toBe(0);

    // Verify account is disconnected
    const [acc] = await db
      .select()
      .from(schema.emailAccounts)
      .where(eq(schema.emailAccounts.id, accountId));
    expect(acc!.status).toBe("disconnected");

    // Verify audit log
    const audits = await auditService.getEvents(principal.tenantId, principal.userId);
    expect(audits.some((a: any) => a.action === "PROVIDER_DISCONNECT")).toBe(true);
  });
});
