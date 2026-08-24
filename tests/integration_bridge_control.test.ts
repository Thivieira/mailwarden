/**
 * Cloud ↔ Bridge control plane, and Desktop ↔ Bridge, over real sockets.
 *
 * The portal's diagnostics and repair buttons are only honest if Cloud can really
 * reach the device. This test runs a real Bridge gateway, lets Cloud discover its
 * endpoint through a real heartbeat, and then drives diagnostics and repair the
 * way the portal does — signed, authenticated, and audited.
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
import { bridgeControlService } from "../src/services/bridge-control";
import { relayAndDeviceService } from "../src/services/portal-services";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { BridgeCore } from "../apps/bridge/src/core/bridge";
import { HttpCloudClient } from "../apps/bridge/src/core/cloud";
import { defaultBridgeConfig } from "../apps/bridge/src/core/config";
import { resolveBridgePaths } from "../apps/bridge/src/core/paths";
import { FileSecretStore } from "../apps/bridge/src/core/secrets";
import { createLocalApi, issueLocalApiToken } from "../apps/bridge/src/core/local-api";
import { LocalBridgeClient } from "../apps/desktop/src/bridge-client";
import type { ProtonDiscoveryAdapters } from "@mailwarden/proton";

let cloudServer: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let dir: string;

const adapters: ProtonDiscoveryAdapters = {
  fileExists: async () => false,
  which: async () => null,
  run: async () => ({ code: 1, stdout: "", stderr: "" }),
  probeTcp: async () => false,
};

beforeAll(async () => {
  cloudServer = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  baseUrl = `http://127.0.0.1:${cloudServer.port}`;
  dir = await mkdtemp(join(tmpdir(), "mailwarden-control-"));
});

afterAll(async () => {
  await cloudServer.stop(true);
  await rm(dir, { recursive: true, force: true });
});

async function teamOwner(label: string) {
  const email = `${label}-${nanoid()}@example.com`;
  const created = await authService.createTenantAndOwner({
    tenantName: `${label} Personal`,
    slug: `${label.toLowerCase()}-${nanoid()}`,
    ownerEmail: email,
    ownerDisplayName: label,
  });
  const personal: AuthPrincipal = {
    workspaceId: created.tenantId,
    tenantId: created.tenantId,
    userId: created.userId,
    scopes: ALL_SCOPES,
    role: "owner",
  } as AuthPrincipal;
  const context = await organizationService.createOrganization(personal, { name: `${label} ${nanoid(6)}` });
  await db.update(schema.tenants).set({ plan: "team" }).where(eq(schema.tenants.id, context.workspace.id));
  return {
    organizationId: context.workspace.id,
    principal: { ...personal, workspaceId: context.workspace.id, tenantId: context.workspace.id } as AuthPrincipal,
  };
}

/** A Bridge with a running gateway, registered against the local Cloud. */
async function registeredBridge(label: string, team: { organizationId: string; principal: AuthPrincipal }) {
  const stateDir = join(dir, label);
  const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: stateDir, MAILWARDEN_BRIDGE_STATE_DIR: stateDir });
  const core = await BridgeCore.create({
    paths,
    config: {
      ...defaultBridgeConfig(`relay-${label}`),
      cloudBaseUrl: baseUrl,
      gateway: { ...defaultBridgeConfig(label).gateway, port: 0 },
    },
    secrets: new FileSecretStore(paths.secretsFile),
    cloud: new HttpCloudClient(baseUrl),
    adapters,
    logger: () => {},
  });

  let approved: Promise<unknown> | null = null;
  const identity = await core.setup({
    onPrompt: (prompt) => {
      approved = relayDeviceService.authorizeProvisioning(team.principal, team.organizationId, prompt.userCode);
    },
  });
  await approved;

  const gateway = await core.startGateway();
  // The device tells Cloud where to reach it, exactly as a tunnelled relay would.
  core.config = {
    ...core.config,
    gateway: { ...core.config.gateway, publicEndpoint: `http://127.0.0.1:${gateway.port}` },
  };
  await core.heartbeatOnce();
  return { core, identity, gateway };
}

describe("Cloud → Bridge control plane", () => {
  test("the portal can run live diagnostics and a repair on a reachable device", async () => {
    const team = await teamOwner("Control");
    const bridge = await registeredBridge("control", team);

    try {
      const devices = await relayDeviceService.listDevices(team.principal, team.organizationId);
      expect(devices[0]!.health?.endpoint).toBe(`http://127.0.0.1:${bridge.gateway.port}`);
      expect(bridgeControlService.isControllable(devices[0]!)).toBe(true);

      const report = await relayAndDeviceService.getDiagnostics(
        team.principal,
        team.organizationId,
        bridge.identity.credential.deviceId
      );
      expect(report.diagnostics.length).toBeGreaterThan(0);
      expect(report.diagnostics.some((entry) => entry.id.startsWith("proton."))).toBe(true);

      const repair = await relayAndDeviceService.executeSafeRepair(
        team.principal,
        team.organizationId,
        bridge.identity.credential.deviceId,
        "recheck_proton"
      );
      expect(repair.action).toBe("recheck_proton");
      // Proton is absent in this harness, so the honest answer is "not applied".
      expect(repair.applied).toBe(false);
      expect(repair.detail).toContain("not found");

      const events = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceId, bridge.identity.credential.deviceId));
      expect(events.some((event: any) => event.action === "RELAY_REPAIR_REQUESTED")).toBe(true);
    } finally {
      await bridge.core.shutdown();
    }
  });

  test("a member of another organization cannot control the device", async () => {
    const team = await teamOwner("ControlOwner");
    const stranger = await teamOwner("ControlStranger");
    const bridge = await registeredBridge("stranger", team);

    try {
      await expect(
        bridgeControlService.diagnostics(
          stranger.principal,
          stranger.organizationId,
          bridge.identity.credential.deviceId
        )
      ).rejects.toThrow();
    } finally {
      await bridge.core.shutdown();
    }
  });

  test("a device that never reported an endpoint cannot be repaired", async () => {
    const team = await teamOwner("Unreachable");
    const stateDir = join(dir, "unreachable");
    const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: stateDir, MAILWARDEN_BRIDGE_STATE_DIR: stateDir });
    const core = await BridgeCore.create({
      paths,
      config: { ...defaultBridgeConfig("relay-unreachable"), cloudBaseUrl: baseUrl },
      secrets: new FileSecretStore(paths.secretsFile),
      cloud: new HttpCloudClient(baseUrl),
      adapters,
      logger: () => {},
    });
    let approved: Promise<unknown> | null = null;
    const identity = await core.setup({
      onPrompt: (prompt) => {
        approved = relayDeviceService.authorizeProvisioning(team.principal, team.organizationId, prompt.userCode);
      },
    });
    await approved;
    await core.heartbeatOnce();

    await expect(
      relayAndDeviceService.executeSafeRepair(
        team.principal,
        team.organizationId,
        identity.credential.deviceId,
        "restart_gateway"
      )
    ).rejects.toThrow(/reachable endpoint/i);
  });

  test("an unsigned control request is refused by the gateway", async () => {
    const team = await teamOwner("Unsigned");
    const bridge = await registeredBridge("unsigned", team);

    try {
      const secret = await relayDeviceService.getGatewaySecret(
        team.organizationId,
        bridge.identity.credential.deviceId
      );
      // A bearer token is enough to read, but never enough to change state.
      const read = await fetch(`http://127.0.0.1:${bridge.gateway.port}/v1/control/diagnostics`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(read.status).toBe(200);

      const write = await fetch(`http://127.0.0.1:${bridge.gateway.port}/v1/control/repair`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart_gateway" }),
      });
      expect(write.status).toBe(403);
    } finally {
      await bridge.core.shutdown();
    }
  });
});

describe("Desktop → Bridge", () => {
  test("the companion renders real daemon state and forwards repairs", async () => {
    const team = await teamOwner("Desktop");
    const bridge = await registeredBridge("desktop", team);
    const token = await issueLocalApiToken(bridge.core.paths.localApiTokenFile);
    const api = createLocalApi(bridge.core, token);
    const apiServer = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: api.fetch });

    try {
      const client = new LocalBridgeClient(
        `http://127.0.0.1:${apiServer.port}`,
        bridge.core.paths.localApiTokenFile
      );
      const state = await client.getStatus();

      expect(state.appState).not.toBe("daemon_unreachable");
      expect(state.device?.id).toBe(bridge.identity.credential.deviceId);
      expect(state.protonBridge.imapPort).toBe(1143);
      // Proton is absent here, so the companion must not claim it is running.
      expect(state.protonBridge.status).not.toBe("running");
      expect(state.message.length).toBeGreaterThan(0);

      const report = await client.getDiagnostics();
      expect(report?.diagnostics.length).toBeGreaterThan(0);

      const repair = await client.repair("recheck_proton");
      expect(repair.action).toBe("recheck_proton");
      expect(repair.applied).toBe(false);
    } finally {
      await apiServer.stop(true);
      await bridge.core.shutdown();
    }
  });

  test("with no daemon running the companion says so instead of inventing a device", async () => {
    const client = new LocalBridgeClient("http://127.0.0.1:1", join(dir, "no-such-token"));
    const state = await client.getStatus();

    expect(state.appState).toBe("daemon_unreachable");
    expect(state.device).toBeUndefined();
    expect(state.accounts).toEqual([]);
    expect(state.message).toContain("not running");
  });
});
