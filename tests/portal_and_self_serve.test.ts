import { describe, it, expect, beforeEach } from "bun:test";
import { app } from "../src/http/app";
import { userAuthService } from "../src/services/user-auth";
import { authService } from "../src/services/auth";
import { policyService } from "../src/services/policy";
import { inviteService } from "../src/services/invites";
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Self-Serve Web Portal & Invite-Only Registration", () => {
  it("Allows initial registration or registration with a valid one-time invite code", async () => {
    // Generate an invite code
    const invite = await inviteService.createInvite({
      expiresInDays: 7,
    });
    expect(invite.code).toStartWith("mw_inv_");
    expect(invite.status).toBe("active");

    const email = `invited_${nanoid()}@example.com`;
    const password = "my-secure-password-123";
    const displayName = "Invited Tester";

    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        displayName,
        inviteCode: invite.code,
      }),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.user.email).toBe(email.toLowerCase());
    expect(data.user.displayName).toBe(displayName);
    expect(data.token).toBeDefined();

    // Verify invite is now burned (used)
    const [updatedInvite] = await db
      .select()
      .from(schema.betaInvites)
      .where(eq(schema.betaInvites.code, invite.code));

    expect(updatedInvite!.usedAt).toBeDefined();

    // Second registration with the same code must fail
    const duplicateInviteRes = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `another_${nanoid()}@example.com`,
        password: "password12345",
        inviteCode: invite.code,
      }),
    });

    expect(duplicateInviteRes.status).toBe(400);
    const dupData = (await duplicateInviteRes.json()) as any;
    expect(dupData.error).toContain("already been used");
  });

  it("Blocks registration without an invite code when users already exist", async () => {
    // Attempt registration without invite code
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `uninvited_${nanoid()}@example.com`,
        password: "password12345",
      }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain("invite code is required");
  });

  it("Enforces email lock on email-specific invites", async () => {
    const targetEmail = `vip_${nanoid()}@example.com`;
    const invite = await inviteService.createInvite({
      email: targetEmail,
      expiresInDays: 3,
    });

    // Someone else tries to use this invite
    const wrongUserRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `imposter_${nanoid()}@example.com`,
        password: "password12345",
        inviteCode: invite.code,
      }),
    });

    expect(wrongUserRes.status).toBe(400);
    const errData = (await wrongUserRes.json()) as any;
    expect(errData.error).toContain("specifically reserved for");

    // Correct user uses this invite
    const correctRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: targetEmail,
        password: "password12345",
        displayName: "VIP User",
        inviteCode: invite.code,
      }),
    });

    expect(correctRes.status).toBe(201);
  });

  it("Allows logged-in admin to generate new invite links via API", async () => {
    // 1. Create invite for admin
    const adminInvite = await inviteService.createInvite({ expiresInDays: 7 });
    const adminEmail = `admin_${nanoid()}@example.com`;
    const regRes = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: "adminpassword123",
        displayName: "Admin User",
        inviteCode: adminInvite.code,
      }),
    });

    const regData = (await regRes.json()) as any;
    const token = regData.token;

    // 2. Admin creates a new invite via API
    const createRes = await app.request("/auth/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: "friend@example.com",
        expiresInDays: 14,
      }),
    });

    expect(createRes.status).toBe(201);
    const createdData = (await createRes.json()) as any;
    expect(createdData.success).toBe(true);
    expect(createdData.invite.inviteUrl).toContain("/portal/signup?invite=mw_inv_");

    // 3. Admin lists invites
    const listRes = await app.request("/auth/invites", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.invites.length).toBeGreaterThanOrEqual(1);
  });

  it("Renders the HTML portal landing page with invite parameter", async () => {
    const invite = await inviteService.createInvite({ expiresInDays: 7 });
    const res = await app.request(`/?invite=${invite.code}`, {
      headers: { Accept: "text/html" },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mailwarden");
    expect(html).toContain("Private Beta Invite Code Applied");
    expect(html).toContain(invite.code);
  });
});
