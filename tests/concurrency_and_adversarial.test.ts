import { describe, it, expect, beforeEach } from "bun:test";
import { authService } from "../src/services/auth";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import { oauthService } from "../src/services/oauth";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

describe("Adversarial Integration & Concurrency Guard", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;

  beforeEach(async () => {
    const id = nanoid();
    const created = await authService.createTenantAndOwner({
      tenantName: `Concurrency Org ${id}`,
      slug: `conc-${id}`,
      ownerEmail: `concurrency-${id}@company.com`,
      ownerDisplayName: "Concurrency User",
    });

    principal = {
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      email: `concurrency-${id}@company.com`,
      displayName: "Concurrency User",
    };

    accountId = nanoid();
    identityId = nanoid();
    const now = new Date();

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: "mock",
      displayName: "Concurrency Mailbox",
      emailAddress: "concurrency@company.com",
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
      email: "concurrency@company.com",
      displayName: "Concurrency Identity",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("Concurrent send attempts with identical idempotency key resolve safely without double-sending", async () => {
    // 1. Create draft
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "client@test.com" }],
      subject: "Concurrent Invoice",
      textBody: "Please find attached invoice for payment.",
    });

    // 2. Request send approval and human-confirm it
    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id, 15);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // 3. Execute 5 concurrent send requests in parallel with the same idempotency key
    const idempotencyKey = `idemp_${nanoid()}`;
    const sendPromises = Array.from({ length: 5 }, () =>
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey,
      })
    );

    const results = await Promise.all(sendPromises);

    // All 5 promises must succeed
    expect(results.length).toBe(5);
    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.providerMessageId).toBeDefined();
      // All results must reference the exact same provider message ID (single dispatch)
      expect(res.providerMessageId).toBe(results[0]!.providerMessageId);
    }
  });

  it("Draft modification during or after approval immediately invalidates the approval", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "innocent@test.com" }],
      subject: "Legitimate Contract",
      textBody: "Initial legitimate text agreed upon.",
    });

    // Approval requested for "innocent@test.com"
    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id, 15);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // Adversarial or concurrent edit modifies recipient to "attacker@evil.com"
    await draftService.editDraft(principal, draft.id, {
      to: [{ address: "attacker@evil.com" }],
    });

    // Attempting to send using the earlier approval must be strictly rejected
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
      })
    ).rejects.toThrow();
  });

  it("Replay attack on an already-used send approval fails", async () => {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "partner@test.com" }],
      subject: "Single Use Send",
      textBody: "This email should only be dispatched once.",
    });

    const { approval, confirmationNonce } = await sendingService.requestSendApproval(principal, draft.id, 15);
    await sendingService.confirmSendApproval(principal, { approvalId: approval.id, confirmationNonce });

    // First send succeeds
    const firstSend = await sendingService.sendDraft(principal, {
      draftId: draft.id,
      approvalId: approval.id,
    });
    expect(firstSend.success).toBe(true);

    // Attempting to reuse the exact same approvalId for another send attempt fails (single-use constraint)
    expect(
      sendingService.sendDraft(principal, {
        draftId: draft.id,
        approvalId: approval.id,
        idempotencyKey: "new_replay_attempt_key",
      })
    ).rejects.toThrow();
  });

  it("Stream ticket concurrent double-consumption is atomically prevented across isolates", async () => {
    const ticket = await authService.createEphemeralStreamTicket(principal);

    // Two concurrent connection attempts racing to redeem the exact same single-use ticket
    const [first, second] = await Promise.allSettled([
      authService.consumeEphemeralStreamTicket(ticket),
      authService.consumeEphemeralStreamTicket(ticket),
    ]);

    // Exactly one must succeed, the other must be rejected
    const successCount = [first, second].filter((r) => r.status === "fulfilled").length;
    const rejectedCount = [first, second].filter((r) => r.status === "rejected").length;

    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(1);
  });

  it("OAuth 2.0 PKCE S256 authorization code exchange succeeds and prevents code replay", async () => {
    const clientId = `client_${nanoid()}`;
    const redirectUri = "https://chat.openai.com/aip/plugin-oauth/callback";
    await oauthService.registerClient({
      clientId,
      clientName: "ChatGPT MCP",
      redirectUris: [redirectUri],
      isPublic: true,
    });

    const codeVerifier = `verifier_${nanoid(32)}`;
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const code = await oauthService.createAuthorizationCode({
      clientId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      scopes: ALL_SCOPES,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
    });

    // Valid exchange
    const tokenResult = await oauthService.exchangeCodeForToken({
      clientId,
      code,
      codeVerifier,
      redirectUri,
    });

    expect(tokenResult.access_token).toBeDefined();
    expect(tokenResult.token_type).toBe("Bearer");

    // Attempting code replay must immediately fail
    expect(
      oauthService.exchangeCodeForToken({
        clientId,
        code,
        codeVerifier,
        redirectUri,
      })
    ).rejects.toThrow();
  });

  it("AI / MCP tool sequence cannot autonomously transition a pending approval to confirmed", async () => {
    const { ALL_MCP_TOOLS } = await import("../src/mcp/server");
    // Verify that NO model-callable tool exists in ALL_MCP_TOOLS that can confirm approvals
    const toolNames = ALL_MCP_TOOLS.map((t) => t.name);
    expect(toolNames.includes("confirm_send_approval")).toBe(false);

    // Create a draft
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "target@company.com" }],
      subject: "Autonomous Dispatch Attempt",
      textBody: "Payload generated by autonomous prompt loop.",
    });

    // Model calls request_send_approval tool
    const requestTool = ALL_MCP_TOOLS.find((t) => t.name === "request_send_approval")!;
    const requestResult: any = await requestTool.handler(principal, {
      draftId: draft.id,
      validityMinutes: 15,
    });

    expect(requestResult.status).toBe("pending");
    expect(requestResult.reviewUrl).toBeDefined();

    // Model attempts to immediately call send_draft without out-of-band human confirmation
    const sendTool = ALL_MCP_TOOLS.find((t) => t.name === "send_draft")!;
    const sendResultPromise = sendTool.handler(principal, {
      draftId: draft.id,
      approvalId: requestResult.approvalId,
    });

    // Strictly fails with SendApprovalNotConfirmedError (AI cannot self-authorize)
    expect(sendResultPromise).rejects.toThrow();
  });

  it("Rotating refresh token flow issues new short-lived access token and detects reuse replay", async () => {
    const clientId = `rt_client_${nanoid()}`;
    const redirectUri = "https://chatgpt.com/aip/plugin-oauth/callback";
    await oauthService.registerClient({
      clientId,
      clientName: "ChatGPT Remote MCP",
      redirectUris: [redirectUri],
      isPublic: true,
    });

    const codeVerifier = `verifier_${nanoid(32)}`;
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const code = await oauthService.createAuthorizationCode({
      clientId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      scopes: ALL_SCOPES,
      redirectUri,
      codeChallenge,
    });

    // 1. Initial exchange -> returns 1h access token + rotating refresh token
    const initialToken = await oauthService.exchangeCodeForToken({
      clientId,
      code,
      codeVerifier,
      redirectUri,
    });

    expect(initialToken.expires_in).toBe(3600); // Short-lived (1 hour)
    expect(initialToken.refresh_token).toBeDefined();

    // 2. Refresh exchange -> returns new access token and new rotated refresh token
    const refreshedToken = await oauthService.refreshAccessToken({
      clientId,
      refreshToken: initialToken.refresh_token!,
    });

    expect(refreshedToken.access_token).toBeDefined();
    expect(refreshedToken.refresh_token).not.toBe(initialToken.refresh_token);

    // 3. Attempting to REUSE the old refresh token triggers replay attack detection and rejection
    expect(
      oauthService.refreshAccessToken({
        clientId,
        refreshToken: initialToken.refresh_token!,
      })
    ).rejects.toThrow();
  });

  it("Forged or tampered JWT tokens are immediately rejected", async () => {
    const validToken = (await authService.createToken({
      id: principal.userId,
      tenantId: principal.tenantId,
      email: principal.email!,
      displayName: principal.displayName!,
    })).token;

    // Tamper with token payload / signature
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.bad_signature_${nanoid(10)}`;

    expect(authService.verifyToken(tamperedToken)).rejects.toThrow();
  });
});
