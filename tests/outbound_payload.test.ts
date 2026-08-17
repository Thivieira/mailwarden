import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { authService } from "../src/services/auth";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import { providerFactory } from "../src/providers/factory";
import { buildGmailMimeMessage, gmailMimeBody } from "../src/providers/gmail";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { ValidationError, SendApprovalInvalidError, SendApprovalNotConfirmedError } from "../src/utils/errors";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  humanSessionService,
  HUMAN_SESSION_COOKIE,
} from "../src/services/human-session";

describe("Reviewed payload matches Gmail dispatch", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;
  let ownerEmail: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Outbound Org ${id}`,
      slug: `out-${id}`,
      ownerEmail: `out-${id}@example.com`,
      ownerDisplayName: "Outbound User",
    });
    ownerEmail = `out-${id}@example.com`;
    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      email: ownerEmail,
    };
    accountId = nanoid();
    identityId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Gmail Mailbox",
      emailAddress: "sender@example.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.emailIdentities).values({
      id: identityId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      email: "sender@example.com",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  async function humanConfirm(approvalId: string, confirmationNonce: string) {
    const { token } = await humanSessionService.mint({
      id: principal.userId,
      tenantId: principal.tenantId,
      email: ownerEmail,
    });
    const { app } = await import("../src/http/app");
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approvalId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${HUMAN_SESSION_COOKIE}=${token}`,
        },
        body: JSON.stringify({ confirmationNonce }),
      })
    );
    expect(res.status).toBe(200);
  }

  it("A. signature appears exactly once in stored body, review, and Gmail MIME", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Sig once",
      textBody: "Hello client.",
      signatureProfileName: "consulting",
    });
    expect(draft.renderedSignature).toBeTruthy();
    const sig = draft.renderedSignature!;
    const occurrences = draft.textBody.split(sig).length - 1;
    expect(occurrences).toBe(1);
    expect(draft.textBody.endsWith(sig)).toBe(true);

    const { approval } = await sendingService.requestSendApproval(principal, draft.id);
    const { token } = await humanSessionService.mint({
      id: principal.userId,
      tenantId: principal.tenantId,
      email: ownerEmail,
    });
    const { app } = await import("../src/http/app");
    const review = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
        headers: { Accept: "text/html", Cookie: `${HUMAN_SESSION_COOKIE}=${token}` },
      })
    );
    const html = await review.text();
    expect(html.split(sig).length - 1).toBe(1);

    const mimeBody = gmailMimeBody(draft);
    expect(mimeBody.split(sig).length - 1).toBe(1);
    expect(mimeBody).toBe(draft.textBody);
  });

  it("B. reviewed final text body matches Gmail MIME body byte-for-byte", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      cc: [{ address: "c@d.com" }],
      subject: "Exact body",
      textBody: "Line one\nLine two\n\nBest,\nThiago",
    });
    expect(gmailMimeBody(draft)).toBe(draft.textBody);
    expect(buildGmailMimeMessage(draft)).toContain("\r\n\r\n" + draft.textBody);
  });

  it("C. Cc is shown in review and emitted in Gmail MIME", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "to@example.com" }],
      cc: [{ address: "cc1@example.com" }, { address: "cc2@example.com" }],
      subject: "With Cc",
      textBody: "Body",
    });
    const mime = buildGmailMimeMessage(draft);
    expect(mime).toContain("Cc:");
    expect(mime).toContain("cc1@example.com");
    expect(mime).toContain("cc2@example.com");

    const { approval } = await sendingService.requestSendApproval(principal, draft.id);
    const { token } = await humanSessionService.mint({
      id: principal.userId,
      tenantId: principal.tenantId,
      email: ownerEmail,
    });
    const { app } = await import("../src/http/app");
    const html = await (
      await app.fetch(
        new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
          headers: { Accept: "text/html", Cookie: `${HUMAN_SESSION_COOKIE}=${token}` },
        })
      )
    ).text();
    expect(html).toContain("cc1@example.com");
    expect(html).toContain("cc2@example.com");
  });

  it("D. threadId change after approval invalidates hash; provider not called", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Threaded",
      textBody: "Reply",
      threadId: "thread_original",
    });
    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await humanConfirm(approval.id, confirmationNonce);

    await db
      .update(schema.drafts)
      .set({ threadId: "thread_mutated", updatedAt: new Date() })
      .where(eq(schema.drafts.id, draft.id));

    const mock = providerFactory.getMockProvider();
    const sendSpy = spyOn(mock, "sendDraft");
    await expect(
      sendingService.sendDraft(principal, { draftId: draft.id, approvalId: approval.id })
    ).rejects.toThrow(SendApprovalInvalidError);
    expect(sendSpy).toHaveBeenCalledTimes(0);
    sendSpy.mockRestore();
  });

  it("E. approve then mutate body: old approval fails with zero provider calls", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Mutate",
      textBody: "Original",
    });
    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id);
    await humanConfirm(approval.id, confirmationNonce);
    await draftService.editDraft(principal, draft.id, { textBody: "Mutated after approve" });

    const mock = providerFactory.getMockProvider();
    const sendSpy = spyOn(mock, "sendDraft");
    await expect(
      sendingService.sendDraft(principal, { draftId: draft.id, approvalId: approval.id })
    ).rejects.toThrow(SendApprovalInvalidError);
    expect(sendSpy).toHaveBeenCalledTimes(0);
    sendSpy.mockRestore();
  });

  it("F. Bcc rejected pre-dispatch / pre-approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      bcc: [{ address: "secret@evil.com" }],
      subject: "Bcc",
      textBody: "x",
    });
    await expect(sendingService.requestSendApproval(principal, draft.id)).rejects.toThrow(ValidationError);
  });

  it("G. htmlBody rejected pre-dispatch / pre-approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Html",
      textBody: "plain",
      htmlBody: "<p>html</p>",
    });
    await expect(sendingService.requestSendApproval(principal, draft.id)).rejects.toThrow(ValidationError);
  });

  it("H. attachments rejected pre-dispatch / pre-approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Att",
      textBody: "x",
      attachments: [{ filename: "a.pdf", contentType: "application/pdf", size: 10 }],
    });
    await expect(sendingService.requestSendApproval(principal, draft.id)).rejects.toThrow(ValidationError);
  });

  it("I. identity not matching connected Gmail account rejected pre-dispatch", async () => {
    const badIdentity = nanoid();
    await db.insert(schema.emailIdentities).values({
      id: badIdentity,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      email: "alias@other.com",
      canSend: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId: badIdentity,
      to: [{ address: "a@b.com" }],
      subject: "Alias",
      textBody: "x",
    });
    await expect(sendingService.requestSendApproval(principal, draft.id)).rejects.toThrow(ValidationError);
  });

  it("J. failed security gates never call provider send", async () => {
    const mock = providerFactory.getMockProvider();
    const sendSpy = spyOn(mock, "sendDraft");

    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Gates",
      textBody: "body",
    });
    const { approval } = await sendingService.requestSendApproval(principal, draft.id);

    // pending
    await expect(
      sendingService.sendDraft(principal, { draftId: draft.id, approvalId: approval.id })
    ).rejects.toThrow(SendApprovalNotConfirmedError);

    // expired
    await db
      .update(schema.sendApprovals)
      .set({ status: "confirmed", confirmedAt: new Date(), expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sendApprovals.id, approval.id));
    await expect(
      sendingService.sendDraft(principal, { draftId: draft.id, approvalId: approval.id })
    ).rejects.toThrow();

    expect(sendSpy).toHaveBeenCalledTimes(0);
    sendSpy.mockRestore();
  });

  it("K. signature text collision in body is not deleted when changing signature", async () => {
    const profiles = await db
      .select()
      .from(schema.signatureProfiles)
      .where(eq(schema.signatureProfiles.userId, principal.userId));
    const consultingProfile = profiles.find((p) => p.name === "consulting");
    expect(consultingProfile).toBeDefined();
    const quoted = consultingProfile!.plainText;

    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "a@b.com" }],
      subject: "Collision",
      textBody: `Please quote this signature text verbatim:\n${quoted}\nThanks.`,
      signatureProfileName: "consulting",
    });
    expect(draft.textBody).toContain(quoted);

    const updated = await draftService.setDraftSignature(principal, draft.id, "professional");
    expect(updated.draft.textBody).toContain(`Please quote this signature text verbatim:\n${quoted}`);
    expect(updated.draft.textBody.endsWith(updated.draft.renderedSignature!)).toBe(true);
    const newSig = updated.draft.renderedSignature!;
    expect(updated.draft.textBody.split(newSig).length - 1).toBe(1);
  });
});
