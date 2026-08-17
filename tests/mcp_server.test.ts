import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { ALL_MCP_TOOLS } from "../src/mcp/server";
import { emailService } from "../src/services/email";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("High-Value Conversational MCP Workflow", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;
  let toolMap: Map<string, (typeof ALL_MCP_TOOLS)[0]>;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `MCP Org ${id}`,
      slug: `mcp-org-${id}`,
      ownerEmail: `ceo-${id}@company.com`,
      ownerDisplayName: "CEO User",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      email: `ceo-${id}@company.com`,
      displayName: "CEO User",
    };

    toolMap = new Map();
    for (const t of ALL_MCP_TOOLS) {
      toolMap.set(t.name, t);
    }

    accountId = nanoid();
    identityId = nanoid();
    const now = new Date();

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "CEO Primary Mailbox",
      emailAddress: "ceo@company.com",
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
      email: "ceo@company.com",
      displayName: "CEO",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Executes the complete high-value conversational flow (overview -> attention -> thread -> memory -> draft -> edit -> signature -> approval -> send)", async () => {
    // 1. Ingest an incoming message from a new contact asking for a proposal
    const incomingEmail = await emailService.ingestEmail(principal, {
      accountId,
      provider: "mock",
      providerMessageId: "msg_proposal_001",
      providerThreadId: "thread_proposal_001",
      from: { name: "David Miller", address: "david@millertech.com" },
      to: [{ name: "CEO", address: "ceo@company.com" }],
      cc: [],
      bcc: [],
      subject: "Partnership RFP Deliverables",
      textBody: "Hi, could you send over your consulting rates and availability by Friday for our upcoming project?",
      receivedAt: new Date(),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    });

    // Step 1: User asks "What's happening across all my email?" -> calls get_inbox_status
    const getInboxStatusTool = toolMap.get("get_inbox_status")!;
    const inboxStatus: any = await getInboxStatusTool.handler(principal, {});
    expect(inboxStatus.totals.unread).toBe(1);
    expect(inboxStatus.topAttentionItems.length).toBeGreaterThan(0);

    // Step 2: User asks "What actually needs my attention?" -> calls get_attention_queue
    const getAttentionQueueTool = toolMap.get("get_attention_queue")!;
    const queue: any = await getAttentionQueueTool.handler(principal, { limit: 5, minScore: 20 });
    expect(queue.count).toBeGreaterThan(0);
    const topItem = queue.items[0];
    expect(topItem.messageId).toBe(incomingEmail.id);

    // Step 3: User asks "Why did this matter? Show me the message" -> calls get_message
    const getMessageTool = toolMap.get("get_message")!;
    const msgDetails: any = await getMessageTool.handler(principal, { messageId: incomingEmail.id });
    expect(msgDetails.subject).toBe("Partnership RFP Deliverables");

    // Step 4: User asks "Show me the thread" -> calls get_thread
    const getThreadTool = toolMap.get("get_thread")!;
    const threadDetails: any = await getThreadTool.handler(principal, {
      accountId,
      threadId: "thread_proposal_001",
      limit: 5,
    });
    expect(threadDetails.messages.length).toBe(1);

    // Step 5: User says "This person is actually a client. Remember that." -> calls set_sender_relationship
    const setRelationshipTool = toolMap.get("set_sender_relationship")!;
    const relResult: any = await setRelationshipTool.handler(principal, {
      emailAddress: "david@millertech.com",
      type: "client",
      organizationName: "MillerTech Enterprises",
      notes: "Prospective enterprise client",
    });
    expect(relResult.success).toBe(true);
    expect(relResult.relationship.type).toBe("client");

    // Step 6: User says "Draft a reply" -> calls draft_reply
    const draftReplyTool = toolMap.get("draft_reply")!;
    const draftResult: any = await draftReplyTool.handler(principal, {
      replyToMessageId: incomingEmail.id,
      textBody: "Hi David, I would be delighted to assist. Our standard consulting rate is $300/hr, and we have availability starting next week.",
    });
    expect(draftResult.draftId).toBeDefined();
    expect(draftResult.payloadHash).toBeDefined();

    // Step 7: User says "Make it shorter" -> calls edit_draft
    const editDraftTool = toolMap.get("edit_draft")!;
    const editResult: any = await editDraftTool.handler(principal, {
      draftId: draftResult.draftId,
      textBody: "Hi David, our consulting rate is $300/hr and we have availability next week. Let's talk soon.",
    });
    expect(editResult.revision).toBe(2);
    // Notice that editing changed the hash
    expect(editResult.payloadHash).not.toBe(draftResult.payloadHash);

    // Step 8: User says "Use my consulting signature" -> calls set_draft_signature
    const setSignatureTool = toolMap.get("set_draft_signature")!;
    const sigResult: any = await setSignatureTool.handler(principal, {
      draftId: draftResult.draftId,
      signatureProfileName: "consulting",
    });
    expect(sigResult.signatureApplied).toBe("consulting");
    expect(sigResult.textBody).toContain("Consultant");

    // Step 9: User says "Show me the final version" -> calls get_draft
    const getDraftTool = toolMap.get("get_draft")!;
    const finalDraft: any = await getDraftTool.handler(principal, { draftId: draftResult.draftId });
    expect(finalDraft.textBody).toContain("Let's talk soon.");

    // Step 10: AI requests send confirmation challenge -> calls request_send_approval
    const requestApprovalTool = toolMap.get("request_send_approval")!;
    const approvalResult: any = await requestApprovalTool.handler(principal, {
      draftId: draftResult.draftId,
      validityMinutes: 15,
    });
    expect(approvalResult.approvalId).toBeDefined();
    expect(approvalResult.payloadHash).toBe(finalDraft.payloadHash);
    expect(approvalResult.status).toBe("pending");

    // Step 10b: Human user explicitly confirms the exact draft preview out-of-band via review URL
    expect(approvalResult.reviewUrl).toBeDefined();
    // Model must never receive confirmationNonce; load it from the approval row as the human form would.
    const [pendingApproval] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approvalResult.approvalId))
      .limit(1);
    expect(pendingApproval).toBeDefined();
    const { sendingService } = await import("../src/services/sending");
    const confirmResponse = await sendingService.confirmSendApproval(principal, {
      approvalId: approvalResult.approvalId,
      confirmationNonce: pendingApproval!.confirmationNonce,
    });
    expect(confirmResponse.status).toBe("confirmed");

    // Step 11: User says "Send it." -> calls send_draft
    const sendDraftTool = toolMap.get("send_draft")!;
    const sendResponse: any = await sendDraftTool.handler(principal, {
      draftId: draftResult.draftId,
      approvalId: approvalResult.approvalId,
    });
    expect(sendResponse.success).toBe(true);
    expect(sendResponse.providerMessageId).toBeDefined();

    // Verify audit logs recorded every step of the workflow
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.tenantId, principal.tenantId));

    expect(audits.some((a: any) => a.action === "RELATIONSHIP_UPDATE")).toBe(true);
    expect(audits.some((a: any) => a.action === "DRAFT_CREATE")).toBe(true);
    expect(audits.some((a: any) => a.action === "DRAFT_UPDATE")).toBe(true);
    expect(audits.some((a: any) => a.action === "SEND_APPROVAL_REQUEST")).toBe(true);
    expect(audits.some((a: any) => a.action === "SEND_SUCCESS")).toBe(true);
  });
});
