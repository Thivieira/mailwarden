import { describe, it, expect, beforeEach } from "bun:test";
import { updateConfig } from "../src/config";
import { authService } from "../src/services/auth";
import { draftService } from "../src/services/drafts";
import { sendingService } from "../src/services/sending";
import {
  humanSessionService,
  HUMAN_SESSION_COOKIE,
  humanSessionCookie,
  humanSessionMaxAge,
} from "../src/services/human-session";
import { userAuthService } from "../src/services/user-auth";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

updateConfig({ BETA_ADMIN_SECRET: "test-beta-admin-secret-that-is-long-enough" });

/**
 * Adversarial coverage for the human-session approval boundary.
 * The model may know reviewUrl; it must not view the draft, retrieve the nonce,
 * or confirm without a real human browser session on the Mailwarden origin.
 */
describe("Human session bind for send confirmation", () => {
  let principal: AuthPrincipal;
  let accountId: string;
  let identityId: string;
  let ownerEmail: string;
  let loginSecret: string;
  let app: any;

  beforeEach(async () => {
    const { app: loaded } = await import("../src/http/app");
    app = loaded;

    const provisioned = await userAuthService.provisionPrivateBetaUser({
      email: `human-${nanoid()}@example.com`,
      displayName: "Human Owner",
    });
    ownerEmail = provisioned.email;
    loginSecret = provisioned.loginSecret;

    principal = {
      tenantId: provisioned.tenantId,
      userId: provisioned.userId,
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
      displayName: "Mock Mailbox",
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

  async function mintHumanCookie(user = { id: principal.userId, tenantId: principal.tenantId, email: ownerEmail }) {
    const { token, expiresAt } = await humanSessionService.mint(user);
    return `${HUMAN_SESSION_COOKIE}=${token}`;
  }

  async function createPendingApproval(body = "Secret body content for the human only.") {
    const { draft } = await draftService.createDraft(principal, {
      accountId,
      identityId,
      to: [{ address: "recipient@example.com", name: "Recipient" }],
      cc: [{ address: "cc@example.com" }],
      subject: "Confidential subject line",
      textBody: body,
    });
    const { approval } = await sendingService.requestSendApproval(principal, draft.id);
    return { draft, approval };
  }

  it("1. public review URL without human cookie shows sign-in and hides draft", async () => {
    const { approval } = await createPendingApproval();
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
        headers: { Accept: "text/html" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Sign in to review this email");
    expect(html).not.toContain("Secret body content");
    expect(html).not.toContain("recipient@example.com");
    expect(html).not.toContain("Confidential subject");
    expect(html).not.toContain(approval.confirmationNonce);
    expect(html).not.toContain(approval.payloadHash);
  });

  it("2. API/MCP bearer cannot substitute for human session on review or confirm", async () => {
    const { approval } = await createPendingApproval();
    const user = await userAuthService.authenticateUser(ownerEmail, loginSecret);
    const { token } = await authService.createToken({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });

    const review = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
        headers: { Accept: "text/html", Authorization: `Bearer ${token}` },
      })
    );
    expect(review.status).toBe(200);
    const reviewHtml = await review.text();
    expect(reviewHtml).toContain("Sign in to review");
    expect(reviewHtml).not.toContain(approval.confirmationNonce);

    const confirm = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(confirm.status).toBe(401);
    const [row] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approval.id))
      .limit(1);
    expect(row.status).toBe("pending");
  });

  it("3. human session JWT is rejected by authService.verifyToken", async () => {
    const { token } = await humanSessionService.mint({
      id: principal.userId,
      tenantId: principal.tenantId,
      email: ownerEmail,
    });
    await expect(authService.verifyToken(token)).rejects.toThrow();
    await expect(authService.verifyToken(`Bearer ${token}`)).rejects.toThrow();
  });

  it("4. nonce alone cannot confirm; approval stays pending", async () => {
    const { approval } = await createPendingApproval();
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(res.status).toBe(401);
    const [row] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approval.id))
      .limit(1);
    expect(row.status).toBe("pending");
  });

  it("5. wrong user cannot view or confirm another user's approval", async () => {
    const { approval } = await createPendingApproval();
    const other = await userAuthService.provisionPrivateBetaUser({
      email: `other-${nanoid()}@example.com`,
      displayName: "Other Human",
    });
    const otherCookie = await mintHumanCookie({
      id: other.userId,
      tenantId: other.tenantId,
      email: other.email,
    });

    const review = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
        headers: { Accept: "text/html", Cookie: otherCookie },
      })
    );
    expect(review.status).toBe(404);
    const reviewHtml = await review.text();
    expect(reviewHtml).not.toContain("Secret body");
    expect(reviewHtml).not.toContain(approval.confirmationNonce);

    const confirm = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: otherCookie,
        },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(confirm.status).toBe(401);
  });

  it("6. correct human may view exact approval; nonce only after human auth", async () => {
    const { approval } = await createPendingApproval();
    const cookie = await mintHumanCookie();
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/review`, {
        headers: { Accept: "text/html", Cookie: cookie },
      })
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Secret body content");
    expect(html).toContain("recipient@example.com");
    expect(html).toContain("cc@example.com");
    expect(html).toContain("Confidential subject");
    expect(html).toContain(approval.confirmationNonce);
    expect(html).toContain(approval.payloadHash);
    expect(html).toContain("sender@example.com");
  });

  it("7. correct session + wrong nonce is rejected", async () => {
    const { approval } = await createPendingApproval();
    const cookie = await mintHumanCookie();
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ confirmationNonce: "cn_wrong_nonce_value" }),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [row] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approval.id))
      .limit(1);
    expect(row.status).toBe("pending");
  });

  it("8. correct session + correct nonce confirms pending → confirmed", async () => {
    const { approval } = await createPendingApproval();
    const cookie = await mintHumanCookie();
    const res = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.status).toBe("confirmed");
    const [row] = await db
      .select()
      .from(schema.sendApprovals)
      .where(eq(schema.sendApprovals.id, approval.id))
      .limit(1);
    expect(row.status).toBe("confirmed");
  });

  it("9. same approval cannot be confirmed twice", async () => {
    const { approval } = await createPendingApproval();
    const cookie = await mintHumanCookie();
    const first = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(first.status).toBe(200);

    const second = await app.fetch(
      new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
      })
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it("10. concurrent confirmation requests: exactly one succeeds", async () => {
    const { approval } = await createPendingApproval();
    const cookie = await mintHumanCookie();
    const req = () =>
      app.fetch(
        new Request(`http://localhost:3000/api/approvals/${approval.id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ confirmationNonce: approval.confirmationNonce }),
        })
      );

    const results = await Promise.all([req(), req(), req()]);
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status !== 200);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
  });

  it("11. MCP registry has no confirmation tool", async () => {
    const { ALL_MCP_TOOLS } = await import("../src/mcp/server");
    const confirmers = ALL_MCP_TOOLS.filter((t) =>
      /confirm.*approval|approve.*send|approval.*confirm/i.test(t.name)
    );
    expect(confirmers).toEqual([]);
    expect(ALL_MCP_TOOLS.some((t) => t.name === "request_send_approval")).toBe(true);
    expect(ALL_MCP_TOOLS.some((t) => t.name === "send_draft")).toBe(true);
  });

  it("API token fails human-session verification and human cookie Set-Cookie shape is correct", async () => {
    const user = await userAuthService.authenticateUser(ownerEmail, loginSecret);
    const { token: apiToken } = await authService.createToken({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
    await expect(humanSessionService.verify(apiToken)).rejects.toThrow();

    const { token, expiresAt } = await humanSessionService.mint({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
    });
    const cookie = humanSessionCookie(token, humanSessionMaxAge(expiresAt));
    expect(cookie).toContain(`${HUMAN_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure"); // localhost APP_BASE_URL
  });
});
