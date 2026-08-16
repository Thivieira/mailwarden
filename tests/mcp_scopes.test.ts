import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { emailService } from "../src/services/email";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import { relationshipService } from "../src/services/relationships";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { AuthorizationError } from "../src/utils/errors";
import { nanoid } from "nanoid";
import { db, schema } from "../src/db";

describe("MCP Granular Permission Scopes", () => {
  let tenantId: string;
  let userId: string;
  let accountId: string;
  let identityId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Scope Test Org ${id}`,
      slug: `scope-test-${id}`,
      ownerEmail: `user-${id}@example.com`,
      ownerDisplayName: "Scope User",
    });
    tenantId = created.tenantId;
    userId = created.userId;

    accountId = nanoid();
    identityId = nanoid();
    const now = new Date();

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId,
      userId,
      provider: "mock",
      displayName: "Test Mailbox",
      emailAddress: "test@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.emailIdentities).values({
      id: identityId,
      tenantId,
      userId,
      accountId,
      email: "test@example.com",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("mail.read scope cannot mutate mailbox state (mark_read, mark_unread, archive)", async () => {
    const readOnlyPrincipal: AuthPrincipal = {
      tenantId,
      userId,
      scopes: ["mail.read", "mail.search"],
    };

    const email = await emailService.ingestEmail(
      { tenantId, userId, scopes: ALL_SCOPES },
      {
        accountId,
        provider: "mock",
        providerMessageId: `msg_${nanoid()}`,
        from: { address: "sender@example.com" },
        to: [{ address: "test@example.com" }],
        cc: [],
        bcc: [],
        subject: "Scope test email",
        textBody: "Hello",
        receivedAt: new Date(),
        headers: {},
        flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
        attachments: [],
      }
    );

    // Read succeeds
    const fetched = await emailService.getEmail(readOnlyPrincipal, email.id);
    expect(fetched.id).toBe(email.id);

    // Mutate state fails
    expect(
      emailService.mutateMailboxState(readOnlyPrincipal, accountId, email.id, "mark_read")
    ).rejects.toThrow(AuthorizationError);

    expect(
      emailService.mutateMailboxState(readOnlyPrincipal, accountId, email.id, "archive")
    ).rejects.toThrow(AuthorizationError);
  });

  it("mail.read scope cannot create drafts", async () => {
    const readOnlyPrincipal: AuthPrincipal = {
      tenantId,
      userId,
      scopes: ["mail.read"],
    };

    expect(
      draftService.createDraft(readOnlyPrincipal, {
        accountId,
        identityId,
        to: [{ address: "someone@example.com" }],
        subject: "Test",
        textBody: "Draft body",
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it("mail.draft scope cannot send email without mail.send scope", async () => {
    const draftPrincipal: AuthPrincipal = {
      tenantId,
      userId,
      scopes: ["mail.read", "mail.draft"],
    };

    const { draft } = await draftService.createDraft(draftPrincipal, {
      accountId,
      identityId,
      to: [{ address: "someone@example.com" }],
      subject: "Test draft",
      textBody: "Draft body",
    });

    const { approval } = await sendingService.requestSendApproval(draftPrincipal, draft.id);

    // Attempting to send without mail.send scope must fail
    expect(
      sendingService.sendDraft(draftPrincipal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it("relationships.read scope cannot modify relationships", async () => {
    const readOnlyPrincipal: AuthPrincipal = {
      tenantId,
      userId,
      scopes: ["relationships.read"],
    };

    expect(
      relationshipService.setSenderRelationship(readOnlyPrincipal, {
        emailAddress: "someone@example.com",
        type: "client",
      })
    ).rejects.toThrow(AuthorizationError);
  });
});
