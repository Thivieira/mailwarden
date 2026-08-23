import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  discoverProtonBridge,
  parseProtonBridgeVersion,
  type ProtonDiscoveryAdapters,
} from "@mailwarden/proton";
import { aggregateRelayStatus, buildDiagnosticReport, buildHealth, type BridgeObservation } from "@mailwarden/relay";
import { BridgeCore } from "../apps/bridge/src/core/bridge";
import { DevCloudClient } from "../apps/bridge/src/core/cloud";
import { defaultBridgeConfig } from "../apps/bridge/src/core/config";
import { resolveBridgePaths } from "../apps/bridge/src/core/paths";
import { FileSecretStore } from "../apps/bridge/src/core/secrets";
import { TunnelManager, type TunnelProcess } from "../apps/bridge/src/core/tunnel";
import { createLocalApi } from "../apps/bridge/src/core/local-api";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mailwarden-relay-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function adapters(overrides: Partial<ProtonDiscoveryAdapters> = {}): ProtonDiscoveryAdapters {
  return {
    fileExists: async () => false,
    which: async () => null,
    run: async () => ({ code: 1, stdout: "", stderr: "" }),
    probeTcp: async () => false,
    ...overrides,
  };
}

describe("proton bridge discovery", () => {
  test("parses the version string Proton actually prints", () => {
    expect(parseProtonBridgeVersion("Proton Mail Bridge 3.25.0")).toBe("3.25.0");
    expect(compareVersions("3.25.0", "3.0.0")).toBe(1);
    expect(compareVersions("2.4.8", "3.0.0")).toBe(-1);
  });

  test("reports not_installed when nothing is found and nothing listens", async () => {
    const result = await discoverProtonBridge(adapters());
    expect(result.state).toBe("not_installed");
    expect(result.imap?.reachable).toBe(false);
  });

  test("reports running when the binary is present and IMAP answers", async () => {
    const result = await discoverProtonBridge(
      adapters({
        fileExists: async (path) => path === "/usr/lib/protonmail/bridge/bridge",
        run: async () => ({ code: 0, stdout: "Proton Mail Bridge 3.25.0\n", stderr: "" }),
        probeTcp: async () => true,
      }),
      { platform: "linux" }
    );
    expect(result.state).toBe("running");
    expect(result.version).toBe("3.25.0");
    expect(result.binaryPath).toBe("/usr/lib/protonmail/bridge/bridge");
  });

  test("reports stopped when the binary exists but nothing is listening", async () => {
    const result = await discoverProtonBridge(
      adapters({
        fileExists: async (path) => path === "/usr/lib/protonmail/bridge/bridge",
        run: async () => ({ code: 0, stdout: "Proton Mail Bridge 3.25.0", stderr: "" }),
      }),
      { platform: "linux" }
    );
    expect(result.state).toBe("stopped");
  });

  test("refuses to claim support for a pre-3.x Bridge", async () => {
    const result = await discoverProtonBridge(
      adapters({
        fileExists: async (path) => path === "/usr/lib/protonmail/bridge/bridge",
        run: async () => ({ code: 0, stdout: "Proton Mail Bridge 2.4.8", stderr: "" }),
        probeTcp: async () => true,
      }),
      { platform: "linux" }
    );
    expect(result.state).toBe("unsupported_version");
  });

  test("trusts a listening endpoint even when the install layout is unknown", async () => {
    const result = await discoverProtonBridge(adapters({ probeTcp: async () => true }), { platform: "linux" });
    expect(result.state).toBe("running");
    expect(result.detail).toContain("binary not found");
  });

  test("probes the configured ports rather than assuming Proton's defaults", async () => {
    const probed: number[] = [];
    await discoverProtonBridge(
      adapters({
        probeTcp: async (_host, port) => {
          probed.push(port);
          return false;
        },
      }),
      { imapPort: 1243, smtpPort: 1125 }
    );
    expect(probed).toEqual([1243, 1125]);
  });
});

function observation(overrides: Partial<BridgeObservation> = {}): BridgeObservation {
  return {
    version: { version: "0.1.0", protocol: 1, platform: "linux-x64" },
    observedAt: "2026-08-17T10:00:00.000Z",
    identity: { deviceId: "relay_1", organizationId: "org_1", revoked: false, generation: 1 },
    cloud: { configured: true, reachable: true, detail: "Cloud reachable" },
    gateway: { listening: true, port: 8080, portConflict: false, detail: "Gateway answering on 127.0.0.1:8080" },
    proton: { state: "running", detail: "Proton Bridge 3.25.0 is running on 127.0.0.1:1143" },
    tunnel: {
      managed: true,
      installed: true,
      credentialPresent: true,
      running: true,
      ready: true,
      hostname: "relay_1.relay.mailwarden.app",
      detail: "Tunnel connected with 4 edge connection(s)",
    },
    secrets: { backend: "secret-service", secure: true, permissionsOk: true, detail: "system keyring" },
    accounts: { configured: 3, connected: 3 },
    ...overrides,
  };
}

describe("health aggregation", () => {
  test("a fully working relay is online", () => {
    const health = buildHealth(observation());
    expect(health.status).toBe("online");
    expect(health.accounts).toEqual({ connected: 3, configured: 3 });
  });

  test("an unregistered device is provisioning", () => {
    expect(buildHealth(observation({ identity: undefined })).status).toBe("provisioning");
  });

  test("a revoked device needs attention", () => {
    const health = buildHealth(
      observation({ identity: { deviceId: "relay_1", organizationId: "org_1", revoked: true, generation: 1 } })
    );
    expect(health.status).toBe("needs_attention");
  });

  test("a dead tunnel takes the relay offline", () => {
    const health = buildHealth(
      observation({
        tunnel: {
          managed: true,
          installed: true,
          credentialPresent: true,
          running: false,
          ready: false,
          detail: "cloudflared is installed but not running",
        },
      })
    );
    expect(health.status).toBe("offline");
  });

  test("a stopped Proton Bridge degrades rather than hides the relay", () => {
    const health = buildHealth(
      observation({ proton: { state: "stopped", detail: "nothing listening on 127.0.0.1:1143" } })
    );
    expect(health.status).toBe("degraded");
    expect(health.components.find((entry) => entry.component === "protonBridge")?.status).toBe("down");
  });

  test("partially connected accounts degrade the relay", () => {
    expect(aggregateRelayStatus(buildHealth(observation({ accounts: { configured: 3, connected: 1 } })).components)).toBe(
      "degraded"
    );
  });
});

describe("diagnostics", () => {
  test("a healthy relay produces no failures", () => {
    const report = buildDiagnosticReport(observation());
    expect(report.overall).toBe("healthy");
    expect(report.diagnostics.every((entry) => entry.status === "pass")).toBe(true);
  });

  test("names the missing device identity and who can fix it", () => {
    const report = buildDiagnosticReport(observation({ identity: undefined }));
    const diagnostic = report.diagnostics.find((entry) => entry.id === "device.identity.missing");
    expect(report.overall).toBe("unhealthy");
    expect(diagnostic?.remediation).toBe("user_action");
    expect(diagnostic?.remedy).toContain("mailwarden-bridge setup");
  });

  test("distinguishes a port conflict from a stopped gateway", () => {
    const conflict = buildDiagnosticReport(
      observation({ gateway: { listening: false, port: 8080, portConflict: true, detail: "held" } })
    );
    expect(conflict.diagnostics.some((entry) => entry.id === "gateway.port_conflict")).toBe(true);

    const stopped = buildDiagnosticReport(
      observation({ gateway: { listening: false, port: 8080, portConflict: false, detail: "not listening" } })
    );
    const diagnostic = stopped.diagnostics.find((entry) => entry.id === "gateway.down");
    expect(diagnostic?.remediation).toBe("automatic");
  });

  test("a missing Proton install is routed to Proton login, not to automation", () => {
    const report = buildDiagnosticReport(
      observation({ proton: { state: "not_installed", detail: "Proton Mail Bridge was not found" } })
    );
    expect(report.diagnostics.find((entry) => entry.id === "proton.not_installed")?.remediation).toBe("proton_login");
  });

  test("warns when credentials sit in a file instead of a keyring", () => {
    const report = buildDiagnosticReport(
      observation({ secrets: { backend: "file", secure: false, permissionsOk: true, detail: "no keyring available" } })
    );
    const diagnostic = report.diagnostics.find((entry) => entry.id === "secrets.backend");
    expect(diagnostic?.severity).toBe("warning");
    expect(report.overall).toBe("degraded");
  });

  test("world-readable credentials are an automatic repair", () => {
    const report = buildDiagnosticReport(
      observation({ secrets: { backend: "secret-service", secure: true, permissionsOk: false, detail: "bad mode" } })
    );
    expect(report.diagnostics.find((entry) => entry.id === "secrets.permissions")?.remediation).toBe("automatic");
  });
});

describe("cloudflare tunnel", () => {
  function fakeProcess(): TunnelProcess & { killed: boolean } {
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const proc = {
      pid: 4242,
      killed: false,
      exited,
      kill() {
        proc.killed = true;
        resolveExit(0);
      },
    };
    return proc;
  }

  const credential = {
    tunnelId: "t1",
    hostname: "relay_1.relay.mailwarden.app",
    token: "tunnel-token-value",
    issuedAt: "2026-08-17T10:00:00.000Z",
  };

  test("reports cloudflared as missing rather than pretending", async () => {
    const manager = new TunnelManager({ adapters: adapters() });
    const status = await manager.status();
    expect(status.installed).toBe(false);
    expect(status.detail).toContain("not installed");
  });

  test("passes the tunnel token through the environment, never through argv", async () => {
    let seen: { command: string[]; env: Record<string, string> } | null = null;
    const manager = new TunnelManager({
      adapters: adapters({
        which: async (command) => (command === "cloudflared" ? "/usr/local/bin/cloudflared" : null),
        run: async (command) =>
          command[1] === "is-active"
            ? { code: 3, stdout: "inactive", stderr: "" }
            : { code: 0, stdout: "cloudflared version 2026.7.3", stderr: "" },
      }),
      spawn: (command, env) => {
        seen = { command, env };
        return fakeProcess();
      },
      readReady: async () => ({ ready: true, connections: 4 }),
    });

    const status = await manager.start(credential);
    expect(status.ready).toBe(true);
    expect(seen!.env.TUNNEL_TOKEN).toBe(credential.token);
    expect(seen!.command.join(" ")).not.toContain(credential.token);
    expect(seen!.command).toContain("--no-autoupdate");
  });

  test("does not race an existing cloudflared service", async () => {
    let spawned = false;
    const manager = new TunnelManager({
      adapters: adapters({
        which: async () => "/usr/local/bin/cloudflared",
        run: async (command) =>
          command[1] === "is-active"
            ? { code: 0, stdout: "active\n", stderr: "" }
            : { code: 0, stdout: "cloudflared version 2026.7.3", stderr: "" },
      }),
      spawn: () => {
        spawned = true;
        return fakeProcess();
      },
      readReady: async () => ({ ready: true, connections: 2 }),
    });

    const status = await manager.start(credential);
    expect(spawned).toBe(false);
    expect(status.externallyManaged).toBe(true);
  });

  test("a running tunnel with no ready connection is degraded, not healthy", async () => {
    const manager = new TunnelManager({
      adapters: adapters({
        which: async () => "/usr/local/bin/cloudflared",
        run: async () => ({ code: 0, stdout: "cloudflared version 2026.7.3", stderr: "" }),
      }),
      spawn: () => fakeProcess(),
      readReady: async () => ({ ready: false, connections: 0 }),
    });
    await manager.start(credential);
    const status = await manager.status();
    expect(status.running).toBe(true);
    expect(status.ready).toBe(false);
  });
});

async function testCore(options: { cloud?: DevCloudClient } = {}) {
  const paths = resolveBridgePaths({ MAILWARDEN_BRIDGE_CONFIG_DIR: dir, MAILWARDEN_BRIDGE_STATE_DIR: dir });
  return BridgeCore.create({
    paths,
    config: defaultBridgeConfig("relay-test"),
    secrets: new FileSecretStore(paths.secretsFile),
    cloud: options.cloud ?? new DevCloudClient(),
    adapters: adapters(),
    logger: () => {},
  });
}

describe("bridge core", () => {
  test("setup registers the device and stores a scoped tunnel credential", async () => {
    const core = await testCore();
    const identity = await core.setup();

    expect(identity.credential.organizationId).toBe("org_dev");
    expect(core.config.tunnel.managed).toBe(true);
    expect(core.config.tunnel.hostname).toContain("relay.mailwarden.app");

    const credential = await core.tunnelCredential();
    expect(credential?.token).toBeTruthy();

    // The tunnel token must live in the secret store, never in the config file.
    expect(await Bun.file(core.paths.configFile).text()).not.toContain(credential!.token);
  });

  test("health before setup asks for provisioning", async () => {
    const core = await testCore();
    const health = await core.health();
    expect(health.status).toBe("provisioning");
    expect(health.deviceId).toBeUndefined();
  });

  test("a revoked device stops relaying and says why", async () => {
    const cloud = new DevCloudClient();
    const core = await testCore({ cloud });
    const identity = await core.setup();
    cloud.revoke(identity.credential.deviceId);

    const result = await core.heartbeatOnce();
    expect(result.state).toBe("revoked");

    const report = await core.diagnostics();
    expect(report.diagnostics.some((entry) => entry.id === "device.identity.revoked")).toBe(true);
  });

  test("recheck_proton repair reports the real Proton state", async () => {
    const core = await testCore();
    const result = await core.repair("recheck_proton");
    expect(result.applied).toBe(false);
    expect(result.detail).toContain("not found");
  });

  test("restart_tunnel refuses when the device holds no tunnel credential", async () => {
    const core = await testCore();
    const result = await core.repair("restart_tunnel");
    expect(result.applied).toBe(false);
    expect(result.detail).toContain("No scoped tunnel credential");
  });
});

describe("local api", () => {
  test("rejects requests without the local token and from a foreign origin", async () => {
    const core = await testCore();
    const app = createLocalApi(core, "local-token-value");

    expect((await app.request("/v1/status")).status).toBe(401);
    expect((await app.request("/v1/status", { headers: { Authorization: "Bearer wrong-token-value" } })).status).toBe(401);
    expect(
      (
        await app.request("/v1/status", {
          headers: { Authorization: "Bearer local-token-value", Origin: "https://evil.example" },
        })
      ).status
    ).toBe(403);
  });

  test("serves the health snapshot the desktop shell renders", async () => {
    const core = await testCore();
    await core.setup();
    const app = createLocalApi(core, "local-token-value");

    const response = await app.request("/v1/status", { headers: { Authorization: "Bearer local-token-value" } });
    const body = (await response.json()) as { registered: boolean; health: { components: unknown[] } };
    expect(body.registered).toBe(true);
    expect(body.health.components.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("devsec_");
  });

  test("refuses an unknown repair action", async () => {
    const core = await testCore();
    const app = createLocalApi(core, "local-token-value");
    const response = await app.request("/v1/repair", {
      method: "POST",
      headers: { Authorization: "Bearer local-token-value", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rm -rf" }),
    });
    expect(response.status).toBe(400);
  });
});
