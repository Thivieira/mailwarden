import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { authService } from "../src/services/auth";
import { encryptionService } from "../src/services/encryption";
import { organizationService } from "../src/services/organizations";
import { providerFactory } from "../src/providers/factory";
import { userAuthService } from "../src/services/user-auth";
import { app } from "../src/http/app";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import type { WorkspaceContext } from "@mailwarden/contracts";

async function identity(label: string) {
  const email = `${label}-${nanoid()}@example.com`;
  const created = await authService.createTenantAndOwner({
    tenantName: `${label} Personal`,
    slug: `${label.toLowerCase()}-${nanoid()}`,
    ownerEmail: email,
    ownerDisplayName: label,
  });
  return {
    ...created,
    email,
    principal: { workspaceId: created.tenantId, tenantId: created.tenantId, userId: created.userId, scopes: ALL_SCOPES, role: "owner" } as AuthPrincipal,
  };
}

describe("Platform workspace security", () => {
  test("preserves Personal Workspace identity, tokens, and encryption AAD while adding Team memberships", async () => {
    const owner = await identity("IdentityOwner");
    const payload = encryptionService.encryptJson({ refreshToken: "kept-secret" }, {
      tenantId: owner.tenantId,
      userId: owner.userId,
    });
    expect(encryptionService.decryptJson<{ refreshToken: string }>(payload, {
      tenantId: owner.tenantId,
      userId: owner.userId,
    }).refreshToken).toBe("kept-secret");

    const team = await organizationService.createOrganization(owner.principal, { name: `Team ${nanoid(6)}` });
    const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, owner.userId)).limit(1);
    expect(stored.tenantId).toBe(owner.tenantId);

    const teamToken = await authService.createToken({
      id: owner.userId,
      tenantId: team.workspace.id,
      email: owner.email,
      displayName: "IdentityOwner",
      role: "owner",
    });
    const teamPrincipal = await authService.verifyToken(teamToken.token);
    expect(teamPrincipal.workspaceId).toBe(team.workspace.id);
    expect(teamPrincipal.personalWorkspaceId).toBe(owner.tenantId);

    const stranger = await identity("IdentityStranger");
    await expect(authService.createToken({
      id: stranger.userId,
      tenantId: team.workspace.id,
      email: stranger.email,
      displayName: "IdentityStranger",
    })).rejects.toThrow("not an active member");
  });

  test("binds invitations atomically and invalidates removed-member sessions", async () => {
    const owner = await identity("InviteOwner");
    const invitee = await identity("Invitee");
    const attacker = await identity("InviteAttacker");
    const team = await organizationService.createOrganization(owner.principal, { name: `Invite Team ${nanoid(6)}` });
    const created = await organizationService.createInvite(owner.principal, team.workspace.id, {
      email: invitee.email,
      role: "admin",
    });

    const joined = await organizationService.acceptInvite(invitee.principal, created.token);
    expect(joined.membership.role).toBe("admin");
    await expect(organizationService.acceptInvite(attacker.principal, created.token)).rejects.toThrow();

    const scoped = await authService.createToken({
      id: invitee.userId,
      tenantId: team.workspace.id,
      email: invitee.email,
      displayName: "Invitee",
      role: "admin",
    });
    expect((await authService.verifyToken(scoped.token)).role).toBe("admin");
    await expect(organizationService.changeMemberRole(
      { ...invitee.principal, workspaceId: team.workspace.id, tenantId: team.workspace.id, role: "admin" },
      team.workspace.id,
      invitee.userId,
      "owner"
    )).rejects.toThrow("own role");

    await organizationService.removeMember(owner.principal, team.workspace.id, invitee.userId);
    await expect(authService.verifyToken(scoped.token)).rejects.toThrow();
  });

  test("continues a Team invitation through new-user signup without reusing beta invites", async () => {
    const owner = await identity("SignupInviteOwner");
    const email = `new-member-${nanoid()}@example.com`;
    const team = await organizationService.createOrganization(owner.principal, { name: `Signup Team ${nanoid(6)}` });
    const created = await organizationService.createInvite(owner.principal, team.workspace.id, { email, role: "member" });
    const registered = await userAuthService.registerUser({
      email,
      password: "correct-horse-battery-staple",
      displayName: "New Member",
      organizationInviteToken: created.token,
    });
    expect(registered.user.tenantId).not.toBe(team.workspace.id);
    expect(registered.joinedWorkspace?.workspace.id).toBe(team.workspace.id);
    expect((await organizationService.listWorkspaces({ userId: registered.user.id })).map((item) => item.workspace.id)).toContain(team.workspace.id);
    await expect(authService.createTenantAndOwner({
      tenantName: "Duplicate",
      slug: `duplicate-${nanoid()}`,
      ownerEmail: email,
      ownerDisplayName: "Duplicate",
    })).rejects.toThrow("already exists");
  });

  test("exposes membership-validated workspace creation and selection APIs", async () => {
    const owner = await identity("ApiOwner");
    const created = await app.request("/api/organizations", {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `API Team ${nanoid(6)}` }),
    });
    expect(created.status).toBe(201);
    const context = (await created.json()) as WorkspaceContext;
    const selected = await app.request(`/api/workspaces/${context.workspace.id}/select`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(selected.status).toBe(200);
    const body = (await selected.json()) as { context: WorkspaceContext; token: string };
    expect(body.context.workspace.id).toBe(context.workspace.id);
    expect((await authService.verifyToken(body.token)).workspaceId).toBe(context.workspace.id);
  });

  test("scopes organization mailboxes by membership, not caller-supplied workspace IDs", async () => {
    const owner = await identity("MailboxOwner");
    const member = await identity("MailboxMember");
    const outsider = await identity("MailboxOutsider");
    const team = await organizationService.createOrganization(owner.principal, { name: `Mailbox Team ${nanoid(6)}` });
    const created = await organizationService.createInvite(owner.principal, team.workspace.id, { email: member.email });
    await organizationService.acceptInvite(member.principal, created.token);

    const accountId = nanoid();
    const now = new Date();
    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: team.workspace.id,
      userId: owner.userId,
      provider: "mock",
      displayName: "Shared Team Mailbox",
      emailAddress: `${nanoid()}@example.com`,
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    });

    const memberInTeam = { ...member.principal, workspaceId: team.workspace.id, tenantId: team.workspace.id };
    expect((await organizationService.listMailboxes(memberInTeam, team.workspace.id))[0]?.id).toBe(accountId);
    expect(await providerFactory.getProviderForAccount(memberInTeam, accountId)).toBe(providerFactory.getMockProvider());
    await expect(organizationService.listMailboxes(outsider.principal, team.workspace.id)).rejects.toThrow("not an active member");
  });

  test("enforces organization, seat, and mailbox capabilities server side", async () => {
    const owner = await identity("QuotaOwner");
    const team = await organizationService.createOrganization(owner.principal, { name: `Quota Team ${nanoid(6)}` });
    await expect(organizationService.createOrganization(owner.principal, { name: `Extra Team ${nanoid(6)}` })).rejects.toThrow("limit reached");

    for (let index = 0; index < 9; index++) {
      await organizationService.createInvite(owner.principal, team.workspace.id, { role: "member" });
    }
    await expect(organizationService.createInvite(owner.principal, team.workspace.id, { role: "member" })).rejects.toThrow("seat limit reached");

    const now = new Date();
    for (let index = 0; index < 3; index++) {
      await db.insert(schema.emailAccounts).values({
        id: nanoid(),
        tenantId: owner.tenantId,
        userId: owner.userId,
        provider: "mock",
        displayName: `Mailbox ${index}`,
        emailAddress: `${nanoid()}@example.com`,
        status: "connected",
        priorityRole: "personal",
        createdAt: now,
        updatedAt: now,
      });
    }
    await expect(organizationService.requireMailboxCapacity(owner.principal, owner.tenantId)).rejects.toThrow("mailbox limit reached");
  });

  test("serves the versioned Bridge provisioning, heartbeat, renewal, and tunnel protocol", async () => {
    const owner = await identity("BridgeOwner");
    const team = await organizationService.createOrganization(owner.principal, { name: `Bridge Team ${nanoid(6)}` });
    const protocolHeaders = { "Content-Type": "application/json", "X-Mailwarden-Bridge-Protocol": "1" };
    const start = await app.request("/api/bridge/v1/provisioning/start", {
      method: "POST",
      headers: protocolHeaders,
      body: JSON.stringify({
        deviceName: "Test Bridge",
        platform: "linux-x64",
        version: "1.0.0",
        protocolVersion: 1,
        capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
      }),
    });
    expect(start.status).toBe(201);
    const pending = await start.json() as { deviceCode: string; userCode: string };

    const authorized = await app.request("/api/relay/provisioning/authorize", {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: team.workspace.id, userCode: pending.userCode }),
    });
    expect(authorized.status).toBe(200);

    const poll = await app.request("/api/bridge/v1/provisioning/poll", {
      method: "POST",
      headers: protocolHeaders,
      body: JSON.stringify({ deviceCode: pending.deviceCode }),
    });
    const provisioned = await poll.json() as any;
    expect(provisioned.state).toBe("authorized");
    expect(provisioned.credential.generation).toBe(1);

    const health = {
      status: "online",
      version: { version: "1.0.0", protocol: 1, platform: "linux-x64" },
      deviceId: provisioned.device.id,
      organizationId: team.workspace.id,
      components: [],
      accounts: { connected: 1, configured: 1 },
      observedAt: new Date().toISOString(),
    };
    const heartbeat = await app.request("/api/bridge/v1/devices/heartbeat", {
      method: "POST",
      headers: { ...protocolHeaders, Authorization: `Bearer ${provisioned.credential.deviceSecret}` },
      body: JSON.stringify({
        heartbeat: {
          deviceId: provisioned.device.id,
          observedAt: health.observedAt,
          status: "online",
          gatewayReachable: true,
          protonBridgeReachable: true,
          tunnelConnected: false,
          connectedAccountCount: 1,
        },
        health,
        generation: 1,
      }),
    });
    expect(await heartbeat.json()).toEqual({ state: "ok", nextHeartbeatSeconds: 30 });

    const renewal = await app.request("/api/bridge/v1/devices/credential/renew", {
      method: "POST",
      headers: { ...protocolHeaders, Authorization: `Bearer ${provisioned.credential.deviceSecret}` },
      body: JSON.stringify({ deviceId: provisioned.device.id, generation: 1 }),
    });
    expect(renewal.status).toBe(200);
    const renewed = await renewal.json() as any;
    expect(renewed.generation).toBe(2);

    const tunnel = await app.request("/api/bridge/v1/devices/tunnel", {
      method: "POST",
      headers: { ...protocolHeaders, Authorization: `Bearer ${renewed.deviceSecret}` },
      body: JSON.stringify({ deviceId: renewed.deviceId }),
    });
    expect(tunnel.status).toBe(404);
    expect((await app.request("/api/health")).status).toBe(200);
  });

  test("applies the additive migration to an empty database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mailwarden-platform-"));
    const database = join(dir, "migration.db");
    try {
      const proc = Bun.spawn(["bun", "run", "src/db/migrate.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: database },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await proc.exited).toBe(0);
      const check = Bun.spawn(["bun", "-e", `import { Database } from 'bun:sqlite'; const db = new Database(${JSON.stringify(database)}); const names = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name); if (!names.includes('organization_invites') || !names.includes('relay_devices') || !names.includes('identity_email_claims')) process.exit(1);`], { stdout: "pipe", stderr: "pipe" });
      expect(await check.exited).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
