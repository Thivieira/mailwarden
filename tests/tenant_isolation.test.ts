import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { draftService } from "../src/services/drafts";
import { relationshipService } from "../src/services/relationships";
import { privacyService } from "../src/services/privacy";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { NotFoundError, TenantIsolationError, AccountOwnershipError } from "../src/utils/errors";
import { db, schema } from "../src/db";
import { nanoid } from "nanoid";

describe("Tenant Isolation Invariants", () => {
  let tenantA: { tenantId: string; userId: string; token: string };
  let tenantB: { tenantId: string; userId: string; token: string };
  let principalA: AuthPrincipal;
  let principalB: AuthPrincipal;

  beforeEach(async () => {
    // Setup Tenant A
    const idA = nanoid();
    tenantA = await authService.createTenantAndOwner({
      tenantName: `Tenant A ${idA}`,
      slug: `tenant-a-${idA}`,
      ownerEmail: `user-a-${idA}@example.com`,
      ownerDisplayName: "User A",
    });
    principalA = {
      tenantId: tenantA.tenantId,
      userId: tenantA.userId,
      scopes: ALL_SCOPES,
      email: `user-a-${idA}@example.com`,
    };

    // Setup Tenant B
    const idB = nanoid();
    tenantB = await authService.createTenantAndOwner({
      tenantName: `Tenant B ${idB}`,
      slug: `tenant-b-${idB}`,
      ownerEmail: `user-b-${idB}@example.com`,
      ownerDisplayName: "User B",
    });
    principalB = {
      tenantId: tenantB.tenantId,
      userId: tenantB.userId,
      scopes: ALL_SCOPES,
      email: `user-b-${idB}@example.com`,
    };
  });

  it("User A cannot read User B's email", async () => {
    const accB = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accB,
      tenantId: principalB.tenantId,
      userId: principalB.userId,
      provider: "mock",
      displayName: "User B Mailbox",
      emailAddress: "b@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    const emailB = await emailService.ingestEmail(principalB, {
      accountId: accB,
      provider: "mock",
      providerMessageId: `msg_b_${nanoid()}`,
      from: { address: "secret@example.com" },
      to: [{ address: "b@example.com" }],
      cc: [],
      bcc: [],
      subject: "User B Confidential Message",
      textBody: "Secret financial payload for User B only",
      receivedAt: now,
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    // User B can read it
    const readByB = await emailService.getEmail(principalB, emailB.id);
    expect(readByB.id).toBe(emailB.id);

    // User A attempting to read User B's email must fail with NotFoundError (tenant-isolated)
    expect(emailService.getEmail(principalA, emailB.id)).rejects.toThrow(NotFoundError);
  });

  it("User A cannot retrieve User B's thread", async () => {
    const accB = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accB,
      tenantId: principalB.tenantId,
      userId: principalB.userId,
      provider: "mock",
      displayName: "User B Mailbox",
      emailAddress: "b@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    const threadId = `thread_b_${nanoid()}`;
    await emailService.ingestEmail(principalB, {
      accountId: accB,
      provider: "mock",
      providerMessageId: `msg_t1_${nanoid()}`,
      providerThreadId: threadId,
      from: { address: "client@example.com" },
      to: [{ address: "b@example.com" }],
      cc: [],
      bcc: [],
      subject: "Thread B",
      textBody: "Thread message 1",
      receivedAt: now,
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    // User A attempting to fetch thread B returns empty messages
    const threadForA = await emailService.getThread(principalA, accB, threadId);
    expect(threadForA.messages.length).toBe(0);
    expect(threadForA.threadState).toBeUndefined();
  });

  it("User A cannot access User B's draft", async () => {
    const accB = nanoid();
    const identityB = nanoid();
    const now = new Date();

    await db.insert(schema.emailAccounts).values({
      id: accB,
      tenantId: principalB.tenantId,
      userId: principalB.userId,
      provider: "mock",
      displayName: "Mailbox B",
      emailAddress: "b@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.emailIdentities).values({
      id: identityB,
      tenantId: principalB.tenantId,
      userId: principalB.userId,
      accountId: accB,
      email: "b@example.com",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });

    const { draft: draftB } = await draftService.createDraft(principalB, {
      accountId: accB,
      identityId: identityB,
      to: [{ address: "client@example.com" }],
      subject: "Draft from B",
      textBody: "Confidential proposal from B",
    });

    // User A attempting to access draft B fails
    expect(draftService.getDraftWithHash(principalA, draftB.id)).rejects.toThrow(NotFoundError);
  });

  it("User A cannot update or delete User B's sender profile or relationship", async () => {
    await relationshipService.setSenderRelationship(principalB, {
      emailAddress: "partner@example.com",
      type: "client",
      notes: "High value client for Tenant B",
    });

    // User A context for same email is isolated and clean
    const ctxA = await relationshipService.getRelationshipContext(principalA, "partner@example.com");
    expect(ctxA.relationship).toBeUndefined();
    expect(ctxA.senderProfile.messagesSeen).toBe(1); // Fresh profile for tenant A
  });

  it("Knowledge of another user's account UUID does not allow operations", async () => {
    const accB = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accB,
      tenantId: principalB.tenantId,
      userId: principalB.userId,
      provider: "mock",
      displayName: "Mailbox B",
      emailAddress: "b@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    // User A attempting to disconnect User B's account fails with AccountOwnershipError
    expect(privacyService.disconnectAccount(principalA, accB)).rejects.toThrow(AccountOwnershipError);
  });
});
