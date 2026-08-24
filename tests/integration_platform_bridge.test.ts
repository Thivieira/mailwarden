/**
 * Platform ↔ Bridge interoperability over real HTTP.
 *
 * This test crosses the old agent boundary: Cloud is the real Hono app on a real
 * socket backed by the real database, and the client is the real Bridge Core with
 * its real `HttpCloudClient` — no DevCloudClient, no in-process shortcuts. It is
 * the acceptance path for provisioning, heartbeat, renewal, and revocation.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { app } from "../src/http/app";
import { db, schema } from "../src/db";
import { authService } from "../src/services/auth";
import { organizationService } from "../src/services/organizations";
import { relayDeviceService } from "../src/services/relay-devices";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { BridgeCore } from "../apps/bridge/src/core/bridge";
import { HttpCloudClient } from "../apps/bridge/src/core/cloud";
import { defaultBridgeConfig } from "../apps/bridge/src/core/config";
import { resolveBridgePaths } from "../apps/bridge/src/core/paths";
import { FileSecretStore } from "../apps/bridge/src/core/secrets";
import type { ProtonDiscoveryAdapters } from "@mailwarden/proton";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  baseUrl = `http://127.0.0.1:${server.port}`;
  dir = await mkdtemp(join(tmpdir(), "mailwarden-interop-"));
});

afterAll(async () => {
  await server.stop(true);
  await rm(dir, { recursive: true, force: true });
});

async function owner(label: string) {
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
    principal: {
      workspaceId: created.tenantId,
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      role: "owner",
    } as AuthPrincipal,
  };
}

/** A team workspace on a plan that includes a shared relay. */
async function teamOrganization(label: string) {
  const account = await owner(label);
  const context = await organizationService.createOrganization(account.principal, { name: `${label} ${nanoid(6)}` });
  await db.update(schema.tenants).set({ plan: "team" }).where(eq(schema.tenants.id, context.workspace.id));
  const principal: AuthPrincipal = { ...account.principal, workspaceId: context.workspace.id, tenantId: context.workspace.id };
  return { account, organizationId: context.workspace.id, principal };
}

const offlineAdapters: ProtonDiscoveryAdapters = {
  fileExists: async () => false,
  which: async () => null,
  run: async () => ({ code: 1, stdout: "", stderr: "" }),
  probeTcp: async () => false,
};

async function bridgeFor(label: string) {
  const stateDir = join(dir, label);
  const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: stateDir, MAILWARDEN_BRIDGE_STATE_DIR: stateDir });
  return BridgeCore.create({
    paths,
    config: { ...defaultBridgeConfig(`relay-${label}`), cloudBaseUrl: baseUrl },
    secrets: new FileSecretStore(paths.secretsFile),
    cloud: new HttpCloudClient(baseUrl),
    adapters: offlineAdapters,
    logger: () => {},
  });
}

/**
 * Runs the browser half of the device authorization while the device polls, the
 * way a human approving in the portal would.
 */
async function provision(core: BridgeCore, principal: AuthPrincipal, organizationId: string) {
  let approved: Promise<unknown> | null = null;
  const identity = await core.setup({
    onPrompt: (prompt) => {
      approved = relayDeviceService.authorizeProvisioning(principal, organizationId, prompt.userCode);
    },
  });
  await approved;
  return identity;
}

describe("Platform ↔ Bridge over HTTP", () => {
  test("Cloud is reachable and reports its health to the Bridge client", async () => {
    const cloud = new HttpCloudClient(baseUrl);
    const ping = await cloud.ping();
    expect(ping.reachable).toBe(true);
  });

  test("a device provisions, registers, heartbeats, renews, and is revoked", async () => {
    const team = await teamOrganization("Relay");
    const core = await bridgeFor("primary");

    // --- provisioning -----------------------------------------------------
    const identity = await provision(core, team.principal, team.organizationId);
    expect(identity.credential.organizationId).toBe(team.organizationId);
    expect(identity.credential.deviceSecret.startsWith("mwrd_")).toBe(true);
    expect(identity.credential.gatewaySecret.startsWith("mwrg_")).toBe(true);
    expect(identity.credential.generation).toBe(1);

    const [stored] = await db
      .select()
      .from(schema.relayDevices)
      .where(eq(schema.relayDevices.id, identity.credential.deviceId))
      .limit(1);
    expect(stored!.tenantId).toBe(team.organizationId);
    expect(stored!.name).toBe("relay-primary");

    // The device secret is never stored in the clear.
    const credentials = await db
      .select()
      .from(schema.relayDeviceCredentials)
      .where(eq(schema.relayDeviceCredentials.deviceId, identity.credential.deviceId));
    expect(credentials.length).toBe(1);
    expect(JSON.stringify(credentials[0]!)).not.toContain(identity.credential.deviceSecret);

    // --- heartbeat --------------------------------------------------------
    const beat = await core.heartbeatOnce();
    expect(beat.state).toBe("ok");

    const devices = await relayDeviceService.listDevices(team.principal, team.organizationId);
    expect(devices.length).toBe(1);
    const device = devices[0]!;
    expect(device.lastSeenAt).toBeTruthy();
    expect(device.health?.components.length).toBeGreaterThan(0);
    // Proton is absent in this harness, so Cloud must see a truthful degraded state.
    expect(device.status).not.toBe("online");

    // --- renewal ----------------------------------------------------------
    const renewed = await core.identity.renewIfNeeded(
      (await core.identity.load())!,
      Date.parse(identity.credential.expiresAt) - 1000
    );
    expect(renewed.credential.generation).toBe(2);
    expect(renewed.credential.deviceSecret).not.toBe(identity.credential.deviceSecret);
    expect((await core.heartbeatOnce()).state).toBe("ok");

    // The superseded credential must stop working immediately.
    expect(
      await relayDeviceService.heartbeat(identity.credential.deviceSecret, await core.health())
    ).toEqual({ state: "revoked" });

    // --- revocation -------------------------------------------------------
    await relayDeviceService.revokeDevice(team.principal, team.organizationId, identity.credential.deviceId);
    const afterRevoke = await core.heartbeatOnce();
    expect(afterRevoke.state).toBe("revoked");
    expect(await core.identity.load()).toBeNull();
    expect((await core.identity.revocation())?.deviceId).toBe(identity.credential.deviceId);

    const report = await core.diagnostics();
    expect(report.diagnostics.some((entry) => entry.id === "device.identity.revoked")).toBe(true);
  });

  test("the managed tunnel endpoint authenticates the device and reports no tunnel yet", async () => {
    const team = await teamOrganization("Tunnel");
    const core = await bridgeFor("tunnel");
    const identity = await provision(core, team.principal, team.organizationId);

    const cloud = new HttpCloudClient(baseUrl);
    expect(await cloud.fetchTunnelCredential(identity.credential)).toBeNull();
    expect(core.config.tunnel.managed).toBe(false);
  });
});

describe("Bridge protocol security", () => {
  test("rejects a device request without the protocol header", async () => {
    const response = await fetch(`${baseUrl}/api/bridge/v1/provisioning/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceName: "no-protocol",
        platform: "linux-x64",
        version: "0.1.0",
        capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
      }),
    });
    expect(response.status).toBe(400);
  });

  test("rejects an unknown device secret on heartbeat", async () => {
    const response = await fetch(`${baseUrl}/api/bridge/v1/devices/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mailwarden-Bridge-Protocol": "1",
        Authorization: `Bearer mwrd_${"x".repeat(48)}`,
      },
      body: JSON.stringify({
        heartbeat: {
          deviceId: "made-up",
          observedAt: new Date().toISOString(),
          status: "online",
          gatewayReachable: true,
          protonBridgeReachable: true,
          tunnelConnected: true,
          connectedAccountCount: 1,
        },
        health: {
          status: "online",
          version: { version: "0.1.0", protocol: 1, platform: "linux-x64" },
          components: [],
          accounts: { connected: 1, configured: 1 },
          observedAt: new Date().toISOString(),
        },
        generation: 1,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "unknown_device" });
  });

  test("a device from one organization cannot claim another organization's identity", async () => {
    const first = await teamOrganization("OrgOne");
    const second = await teamOrganization("OrgTwo");
    const core = await bridgeFor("crossorg");
    const identity = await provision(core, first.principal, first.organizationId);

    const health = await core.health();
    await expect(
      relayDeviceService.heartbeat(identity.credential.deviceSecret, {
        ...health,
        organizationId: second.organizationId,
      })
    ).rejects.toThrow(/organization mismatch/i);

    // And the other organization cannot see or revoke the device.
    expect(await relayDeviceService.listDevices(second.principal, second.organizationId)).toEqual([]);
    await expect(
      relayDeviceService.revokeDevice(second.principal, second.organizationId, identity.credential.deviceId)
    ).rejects.toThrow();
  });

  test("an expired provisioning session cannot be redeemed", async () => {
    const team = await teamOrganization("Expired");
    const cloud = new HttpCloudClient(baseUrl);
    const start = await cloud.startProvisioning({
      deviceName: "expired-device",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
    });

    await db
      .update(schema.relayProvisioningSessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.relayProvisioningSessions.state, "pending"));

    expect((await cloud.pollProvisioning(start.deviceCode)).state).toBe("expired");
    await expect(
      relayDeviceService.authorizeProvisioning(team.principal, team.organizationId, start.userCode)
    ).rejects.toThrow(/invalid, expired, or already authorized/i);
  });
});

describe("Provisioning abuse limits", () => {
  test("the public provisioning endpoint is rate limited", async () => {
    const previous = process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE;
    process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE = "1";
    try {
      const cloud = new HttpCloudClient(baseUrl);
      const request = {
        deviceName: "flood",
        platform: "linux-x64",
        version: "0.1.0",
        capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
      };
      // The first start may already exceed the window because earlier tests
      // created sessions, so accept either outcome here and require the next to fail.
      await cloud.startProvisioning(request).catch(() => undefined);
      await expect(cloud.startProvisioning(request)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE;
      else process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE = previous;
    }
  });

  test("expired provisioning sessions are purged, and a late poll still gets a clear answer", async () => {
    const cloud = new HttpCloudClient(baseUrl);
    const start = await cloud.startProvisioning({
      deviceName: "stale",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
    });

    // Age this session past the retention window, then start another one to
    // trigger the purge that runs on every start.
    await db
      .update(schema.relayProvisioningSessions)
      .set({ expiresAt: new Date(Date.now() - 3 * 60 * 60_000) })
      .where(eq(schema.relayProvisioningSessions.deviceName, "stale"));
    await cloud.startProvisioning({
      deviceName: "fresh",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
    });

    const remaining = await db
      .select()
      .from(schema.relayProvisioningSessions)
      .where(eq(schema.relayProvisioningSessions.deviceName, "stale"));
    expect(remaining.length).toBe(0);
    expect((await cloud.pollProvisioning(start.deviceCode)).state).toBe("denied");
  });
});
