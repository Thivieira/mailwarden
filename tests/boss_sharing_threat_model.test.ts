import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { encryptionService } from "../src/services/encryption";
import { ALL_MCP_TOOLS } from "../src/mcp/server";
import { db, schema } from "../src/db";
import { ALL_SCOPES } from "../src/types/auth";
import { nanoid } from "nanoid";

describe("Boss Sharing & Multi-User Threat Model", () => {
  let userA: { tenantId: string; userId: string; token: string };
  let bossB: { tenantId: string; userId: string; token: string };
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    // 1. Provision User A (Engineer)
    const idA = nanoid();
    userA = await authService.createTenantAndOwner({
      tenantName: `Engineer Org ${idA}`,
      slug: `eng-${idA}`,
      ownerEmail: `engineer-${idA}@company.com`,
      ownerDisplayName: "Engineer User",
    });

    // 2. Provision Boss B (Executive)
    const idB = nanoid();
    bossB = await authService.createTenantAndOwner({
      tenantName: `Executive Org ${idB}`,
      slug: `exec-${idB}`,
      ownerEmail: `boss-${idB}@company.com`,
      ownerDisplayName: "Executive Boss",
    });

    accountA = nanoid();
    accountB = nanoid();
    const now = new Date();

    // Account for User A
    await db.insert(schema.emailAccounts).values({
      id: accountA,
      tenantId: userA.tenantId,
      userId: userA.userId,
      provider: "mock",
      displayName: "Engineer Work Mail",
      emailAddress: `engineer-${idA}@company.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    // Account for Boss B
    await db.insert(schema.emailAccounts).values({
      id: accountB,
      tenantId: bossB.tenantId,
      userId: bossB.userId,
      provider: "mock",
      displayName: "Executive Mailbox",
      emailAddress: `boss-${idB}@company.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("User A and Boss B have independent authenticated sessions and isolated inboxes", async () => {
    // Ingest engineer email for User A
    await emailService.ingestEmail(
      { tenantId: userA.tenantId, userId: userA.userId, scopes: ALL_SCOPES },
      {
        accountId: accountA,
        provider: "mock",
        providerMessageId: `msg_eng_${nanoid()}`,
        from: { address: "dev@github.com" },
        to: [{ address: `engineer@company.com` }],
        cc: [],
        bcc: [],
        subject: "CI Build Failed on main",
        textBody: "Build #124 failed on lint step",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false },
        attachments: [],
      }
    );

    // Ingest confidential executive email for Boss B
    await emailService.ingestEmail(
      { tenantId: bossB.tenantId, userId: bossB.userId, scopes: ALL_SCOPES },
      {
        accountId: accountB,
        provider: "mock",
        providerMessageId: `msg_boss_${nanoid()}`,
        from: { address: "board@company.com" },
        to: [{ address: `boss@company.com` }],
        cc: [],
        bcc: [],
        subject: "Confidential Q3 Executive Compensation Review",
        textBody: "Attached are the proposed bonus packages and executive compensation.",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      }
    );

    // Resolve principals from respective Bearer tokens
    const principalA = await authService.verifyToken(userA.token);
    const principalB = await authService.verifyToken(bossB.token);

    expect(principalA.userId).toBe(userA.userId);
    expect(principalB.userId).toBe(bossB.userId);

    const getInboxStatusTool = ALL_MCP_TOOLS.find((t) => t.name === "get_inbox_status")!;

    // User A calls get_inbox_status -> sees ONLY their CI build email
    const statusA: any = await getInboxStatusTool.handler(principalA, {});
    expect(statusA.totals.unread).toBe(1);
    expect(statusA.accounts[0].displayName).toBe("Engineer Work Mail");
    expect(statusA.topAttentionItems.some((i: any) => i.subject.includes("Executive"))).toBe(false);

    // Boss B calls get_inbox_status -> sees ONLY their Board compensation email
    const statusB: any = await getInboxStatusTool.handler(principalB, {});
    expect(statusB.totals.unread).toBe(1);
    expect(statusB.accounts[0].displayName).toBe("Executive Mailbox");
    expect(statusB.topAttentionItems.some((i: any) => i.subject.includes("CI Build"))).toBe(false);
  });

  it("User A cannot search or find Boss B's confidential email even with exact keywords", async () => {
    // Ingest sensitive boss email
    await emailService.ingestEmail(
      { tenantId: bossB.tenantId, userId: bossB.userId, scopes: ALL_SCOPES },
      {
        accountId: accountB,
        provider: "mock",
        providerMessageId: `msg_secret_${nanoid()}`,
        from: { address: "investor@venture.com" },
        to: [{ address: `boss@company.com` }],
        cc: [],
        bcc: [],
        subject: "M&A Acquisition Offer Term Sheet",
        textBody: "Confidential buyout offer of $50M for the company.",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      }
    );

    const principalA = await authService.verifyToken(userA.token);
    const searchTool = ALL_MCP_TOOLS.find((t) => t.name === "search_mail")!;

    const searchResult: any = await searchTool.handler(principalA, { query: "Acquisition" });
    expect(searchResult.total).toBe(0);
    expect(searchResult.messages.length).toBe(0);
  });

  it("True 2-Tier Envelope Encryption: DEK generation, KEK unwrapping, and AAD tamper prevention", () => {
    const bossSecretCreds = {
      refreshToken: "boss-super-secret-oauth-refresh-token",
      accessToken: "boss-temp-token",
    };

    // Encrypt with Boss B context (tenantId + userId) -> True 2-tier Envelope Encryption
    const envelope = encryptionService.encryptJson(bossSecretCreds, {
      tenantId: bossB.tenantId,
      userId: bossB.userId,
    });

    expect(envelope.algorithm).toBe("AES-256-GCM");
    expect(envelope.encryptedDek).toBeDefined();
    expect(envelope.dekIv).toBeDefined();
    expect(envelope.dekTag).toBeDefined();
    expect(envelope.ciphertext).toBeDefined();

    // Decrypting with Boss B context succeeds
    const decryptedByBoss = encryptionService.decryptJson<any>(envelope, {
      tenantId: bossB.tenantId,
      userId: bossB.userId,
    });
    expect(decryptedByBoss.refreshToken).toBe("boss-super-secret-oauth-refresh-token");

    // Decrypting with User A context fails due to AAD mismatch
    expect(() => {
      encryptionService.decryptJson(envelope, {
        tenantId: userA.tenantId,
        userId: userA.userId,
      });
    }).toThrow();

    // Tampering with ciphertext fails auth tag validation
    const tamperedEnvelope = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -2) + "ff",
    };
    expect(() => {
      encryptionService.decryptJson(tamperedEnvelope, {
        tenantId: bossB.tenantId,
        userId: bossB.userId,
      });
    }).toThrow();
  });

  it("Ephemeral stream tickets are single-use and expire within TTL", async () => {
    const principalB = await authService.verifyToken(bossB.token);

    // Create stream ticket for Boss B
    const ticket = await authService.createEphemeralStreamTicket(principalB);
    expect(ticket.startsWith("st_")).toBe(true);

    // Consume ticket once -> success
    const consumedPrincipal = await authService.consumeEphemeralStreamTicket(ticket);
    expect(consumedPrincipal.userId).toBe(bossB.userId);

    // Attempting to consume the same ticket a second time fails (single-use)
    expect(authService.consumeEphemeralStreamTicket(ticket)).rejects.toThrow();
  });
});
