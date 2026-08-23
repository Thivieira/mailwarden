import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRIDGE_CONFIG_VERSION,
  applyLegacyEnvOverrides,
  defaultBridgeConfig,
  loadBridgeConfig,
  parseBridgeConfig,
  saveBridgeConfig,
} from "../apps/bridge/src/core/config";
import { resolveBridgePaths } from "../apps/bridge/src/core/paths";
import { FileSecretStore, createSecretStore } from "../apps/bridge/src/core/secrets";
import { DevCloudClient } from "../apps/bridge/src/core/cloud";
import { DeviceIdentityManager } from "../apps/bridge/src/core/identity";
import { issueLocalApiToken, readLocalApiToken } from "../apps/bridge/src/core/local-api";
import { planSystemdInstall } from "../apps/bridge/src/core/service";
import { AccountActivityTracker } from "../apps/bridge/src/core/accounts";
import type { RelayCapabilities } from "@mailwarden/contracts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mailwarden-bridge-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CAPABILITIES: RelayCapabilities = { protonImap: true, protonSmtp: true, cloudflareTunnel: true };

describe("bridge paths", () => {
  test("uses the system directories for a root service and XDG for a user", () => {
    const system = resolveBridgePaths({
      MAILWARDEN_BRIDGE_CONFIG_DIR: "/etc/mailwarden",
      MAILWARDEN_BRIDGE_STATE_DIR: "/var/lib/mailwarden",
    });
    expect(system.configFile).toBe("/etc/mailwarden/bridge.json");
    expect(system.secretsFile).toBe("/var/lib/mailwarden/secrets.json");

    const user = resolveBridgePaths({ HOME: "/home/alice", XDG_CONFIG_HOME: "", XDG_STATE_HOME: "" });
    expect(user.configFile).toBe("/home/alice/.config/mailwarden-bridge/bridge.json");
  });
});

describe("bridge config", () => {
  test("defaults bind the gateway to loopback", () => {
    const config = defaultBridgeConfig("relay-01");
    expect(config.gateway.host).toBe("127.0.0.1");
    expect(config.configVersion).toBe(BRIDGE_CONFIG_VERSION);
  });

  test("refuses config written by a newer Bridge", () => {
    expect(() => parseBridgeConfig({ configVersion: 99, deviceName: "relay-01" })).toThrow(/newer than this Bridge/);
  });

  test("round-trips through disk without holding any secret", async () => {
    const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: dir, MAILWARDEN_BRIDGE_STATE_DIR: dir });
    const config = { ...defaultBridgeConfig("relay-01"), cloudBaseUrl: "https://mailwarden.app" };
    await saveBridgeConfig(paths, config);

    const written = await Bun.file(paths.configFile).text();
    expect(written).not.toMatch(/secret|password|token/i);
    expect((await loadBridgeConfig(paths, "fallback")).cloudBaseUrl).toBe("https://mailwarden.app");
  });

  test("legacy relay environment variables still win", () => {
    const config = applyLegacyEnvOverrides(defaultBridgeConfig("relay-01"), {
      PORT: "9090",
      PROTON_BRIDGE_HOST: "127.0.0.1",
      PROTON_BRIDGE_IMAP_PORT: "1243",
    });
    expect(config.gateway.port).toBe(9090);
    expect(config.proton.imapPort).toBe(1243);
    expect(config.proton.smtpPort).toBe(1025);
  });
});

describe("secret store", () => {
  test("writes credentials 0600 and reports a clean audit", async () => {
    const store = new FileSecretStore(join(dir, "state", "secrets.json"));
    await store.set("device.credential", "sensitive");
    expect(await store.get("device.credential")).toBe("sensitive");

    const mode = (await stat(join(dir, "state", "secrets.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect((await store.audit()).permissionsOk).toBe(true);
  });

  test("flags and repairs world-readable credentials", async () => {
    const file = join(dir, "secrets.json");
    const store = new FileSecretStore(file);
    await store.set("device.credential", "sensitive");
    await chmod(file, 0o644);

    expect((await store.audit()).permissionsOk).toBe(false);
    expect(await store.repairPermissions()).toBe(true);
    expect((await store.audit()).permissionsOk).toBe(true);
  });

  test("deleting a credential removes it", async () => {
    const store = new FileSecretStore(join(dir, "secrets.json"));
    await store.set("tunnel.credential", "token");
    await store.delete("tunnel.credential");
    expect(await store.get("tunnel.credential")).toBeNull();
  });

  test("falls back to the file store when no keyring answers", async () => {
    const store = await createSecretStore(resolveBridgePaths({ MAILWARDEN_BRIDGE_STATE_DIR: dir }), {
      fileExists: async () => false,
      which: async () => null,
      run: async () => ({ code: 127, stdout: "", stderr: "" }),
      probeTcp: async () => false,
    });
    expect(store.backend).toBe("file");
    expect(store.secure).toBe(false);
  });
});

describe("device identity", () => {
  function manager(options?: ConstructorParameters<typeof DevCloudClient>[0]) {
    const cloud = new DevCloudClient(options);
    return { cloud, identity: new DeviceIdentityManager(new FileSecretStore(join(dir, "secrets.json")), cloud) };
  }

  test("provisions through the browser flow and persists a scoped credential", async () => {
    const { identity } = manager();
    const prompts: string[] = [];
    const stored = await identity.provision({
      deviceName: "relay-01",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: CAPABILITIES,
      onPrompt: (prompt) => prompts.push(prompt.userCode),
    });

    expect(prompts.length).toBe(1);
    expect(stored.credential.deviceSecret).toBeTruthy();
    expect(stored.credential.gatewaySecret).not.toBe(stored.credential.deviceSecret);
    expect((await identity.load())?.credential.deviceId).toBe(stored.credential.deviceId);
  });

  test("waits while the human has not authorized yet", async () => {
    const now = { value: Date.parse("2026-08-17T10:00:00Z") };
    const cloud = new DevCloudClient({ pendingSeconds: 10, now: () => now.value });
    const identity = new DeviceIdentityManager(new FileSecretStore(join(dir, "secrets.json")), cloud);

    let polls = 0;
    const stored = await identity.provision({
      deviceName: "relay-01",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: CAPABILITIES,
      now: () => now.value,
      sleep: async (ms) => {
        polls += 1;
        now.value += ms;
      },
    });
    expect(polls).toBeGreaterThan(0);
    expect(stored.credential.generation).toBe(1);
  });

  test("erases the credential when Cloud reports revocation", async () => {
    const { cloud, identity } = manager();
    const stored = await identity.provision({
      deviceName: "relay-01",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: CAPABILITIES,
    });
    cloud.revoke(stored.credential.deviceId);

    const response = await identity.heartbeat(
      stored,
      {
        deviceId: stored.credential.deviceId,
        observedAt: new Date().toISOString(),
        status: "online",
        gatewayReachable: true,
        protonBridgeReachable: true,
        tunnelConnected: true,
        connectedAccountCount: 1,
      },
      {
        status: "online",
        version: { version: "0.1.0", protocol: 1, platform: "linux-x64" },
        components: [],
        accounts: { connected: 1, configured: 1 },
        observedAt: new Date().toISOString(),
      }
    );

    expect(response.state).toBe("revoked");
    expect(await identity.load()).toBeNull();
    expect((await identity.revocation())?.deviceId).toBe(stored.credential.deviceId);
  });

  test("renews a credential inside the last quarter of its life", async () => {
    const { identity } = manager();
    const stored = await identity.provision({
      deviceName: "relay-01",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: CAPABILITIES,
    });

    const issued = Date.parse(stored.credential.issuedAt);
    const expires = Date.parse(stored.credential.expiresAt);
    expect(DeviceIdentityManager.needsRenewal(stored.credential, issued + 1000)).toBe(false);
    expect(DeviceIdentityManager.needsRenewal(stored.credential, expires - 1000)).toBe(true);

    const renewed = await identity.renewIfNeeded(stored, expires - 1000);
    expect(renewed.credential.generation).toBe(2);
    expect(renewed.credential.deviceSecret).not.toBe(stored.credential.deviceSecret);
    expect((await identity.load())?.credential.generation).toBe(2);
  });

  test("keeps a valid credential when renewal cannot reach Cloud", async () => {
    const { cloud, identity } = manager();
    const stored = await identity.provision({
      deviceName: "relay-01",
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: CAPABILITIES,
    });
    cloud.renewCredential = async () => {
      throw new Error("network down");
    };
    const expires = Date.parse(stored.credential.expiresAt);
    const result = await identity.renewIfNeeded(stored, expires - 1000);
    expect(result.credential.generation).toBe(1);
  });
});

describe("local API token", () => {
  test("is written 0600 and read back", async () => {
    const file = join(dir, "runtime", "local-api.token");
    const token = await issueLocalApiToken(file);
    expect(token.length).toBeGreaterThan(32);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readLocalApiToken(file)).toBe(token);
  });

  test("reports no token when the file is absent", async () => {
    expect(await readLocalApiToken(join(dir, "missing.token"))).toBeNull();
  });
});

describe("systemd plan", () => {
  test("runs unprivileged and never embeds a secret", () => {
    const plan = planSystemdInstall({ execPath: "/usr/local/bin/bun", daemonPath: "/opt/mailwarden/daemon.ts" });
    expect(plan.unitContents).toContain("User=mailwarden");
    expect(plan.unitContents).toContain("NoNewPrivileges=true");
    expect(plan.unitContents).not.toMatch(/PROTON_GATEWAY_API_KEY|TUNNEL_TOKEN|password/i);
    expect(plan.commands.some((command) => command.includes("systemctl daemon-reload"))).toBe(true);
  });
});

describe("account activity", () => {
  test("counts an account as connected only while it is recently successful", () => {
    const tracker = new AccountActivityTracker(60_000);
    const now = Date.parse("2026-08-17T10:00:00Z");
    tracker.record("account_1", true, now);
    tracker.record("account_2", false, now);

    expect(tracker.summary(now)).toEqual({ configured: 2, connected: 1 });
    expect(tracker.summary(now + 120_000)).toEqual({ configured: 2, connected: 0 });
  });
});

describe("config file discovery", () => {
  test("falls back to defaults when nothing is written yet", async () => {
    const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: join(dir, "empty") });
    expect((await loadBridgeConfig(paths, "relay-99")).deviceName).toBe("relay-99");
  });

  test("rejects a corrupt config rather than guessing", async () => {
    const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: dir });
    await writeFile(paths.configFile, JSON.stringify({ configVersion: 1, gateway: { port: "not-a-port" } }));
    await expect(loadBridgeConfig(paths, "relay-01")).rejects.toThrow();
  });
});
