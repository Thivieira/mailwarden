#!/usr/bin/env bun
/**
 * `mailwarden-bridge` — the operator's view of Bridge Core.
 *
 * Every command is a thin call into Bridge Core: the CLI formats, it does not
 * interpret. When the daemon is running the CLI reads its live view through the
 * local API so `status` reflects what the relay is actually serving.
 */
import { BridgeCore, BRIDGE_VERSION } from "./core/bridge";
import { startDaemon } from "./daemon";
import { readLocalApiToken } from "./core/local-api";
import { saveBridgeConfig } from "./core/config";
import { BRIDGE_UNIT_NAME, planSystemdInstall, planSystemdUninstall } from "./core/service";
import {
  BRIDGE_REPAIR_ACTIONS,
  type BridgeDiagnosticReport,
  type BridgeHealth,
  type BridgeRepairAction,
} from "@mailwarden/contracts";

const SYMBOLS: Record<string, string> = {
  ok: "●",
  degraded: "◐",
  down: "○",
  unknown: "◌",
  needs_attention: "▲",
};

function print(line = ""): void {
  console.log(line);
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

async function daemonFetch<T>(core: BridgeCore, path: string, init?: RequestInit): Promise<T | null> {
  const token = await readLocalApiToken(core.paths.localApiTokenFile);
  if (!token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${core.config.localApi.port}/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers as any) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function renderHealth(health: BridgeHealth, deviceLine?: string): void {
  print(`Mailwarden Bridge ${health.version.version} (${health.version.platform})`);
  if (deviceLine) print(deviceLine);
  print(`Relay status: ${health.status.toUpperCase()}`);
  print();
  for (const component of health.components) {
    print(`${SYMBOLS[component.status] ?? "?"} ${component.component.padEnd(15)} ${component.detail}`);
  }
  print();
  print(`Accounts: ${health.accounts.connected} connected of ${health.accounts.configured} seen`);
}

function renderDiagnostics(report: BridgeDiagnosticReport): void {
  print(`Diagnostics: ${report.overall.toUpperCase()} (${report.generatedAt})`);
  print();
  for (const diagnostic of report.diagnostics) {
    const mark = diagnostic.status === "pass" ? "PASS" : diagnostic.severity === "error" ? "FAIL" : "WARN";
    print(`[${mark}] ${diagnostic.title}: ${diagnostic.explanation}`);
    if (diagnostic.remedy) print(`       → ${diagnostic.remedy} (${diagnostic.remediation.replace("_", " ")})`);
  }
}

async function systemdUnitInstalled(core: BridgeCore): Promise<boolean> {
  return core.adapters.fileExists(`/etc/systemd/system/${BRIDGE_UNIT_NAME}`);
}

async function commandSetup(core: BridgeCore, argv: string[]): Promise<number> {
  const organizationId = argv.find((arg) => arg.startsWith("--organization="))?.split("=")[1];
  const cloudUrl = argv.find((arg) => arg.startsWith("--cloud="))?.split("=")[1];
  if (cloudUrl) {
    core.config = { ...core.config, cloudBaseUrl: cloudUrl };
    await saveBridgeConfig(core.paths, core.config);
  }
  if (!core.config.cloudBaseUrl) {
    print("No Mailwarden Cloud URL is configured; using the development adapter.");
    print("Pass --cloud=https://your-mailwarden-host to register against real Cloud.");
    print();
  }

  const identity = await core.setup({
    organizationId,
    onPrompt: (prompt) => {
      print("To authorize this device, open:");
      print(`  ${prompt.verificationUriComplete ?? prompt.verificationUri}`);
      print(`  and enter the code: ${prompt.userCode}`);
      print();
      print("Waiting for approval…");
    },
  });

  print(`Registered as device ${identity.credential.deviceId} in organization ${identity.credential.organizationId}.`);
  const credential = await core.tunnelCredential();
  if (credential) print(`Managed relay hostname: ${credential.hostname}`);
  print();
  print("Next: `mailwarden-bridge start` (or `systemctl start mailwarden-bridge`).");
  return 0;
}

async function commandStatus(core: BridgeCore, argv: string[]): Promise<number> {
  const live = await daemonFetch<{ health: BridgeHealth; registered: boolean; deviceId?: string; organizationId?: string; revoked: boolean; tunnelHostname?: string }>(
    core,
    "/status"
  );
  const health = live?.health ?? (await core.health());

  if (hasFlag(argv, "--json")) {
    print(JSON.stringify(live ?? { health, daemon: false }, null, 2));
    return health.status === "online" ? 0 : 1;
  }

  const identity = live ?? (await core.identity.load().then((stored) => (stored ? { registered: true, deviceId: stored.credential.deviceId, organizationId: stored.credential.organizationId, revoked: false, tunnelHostname: core.config.tunnel.hostname } : null)));
  const deviceLine = identity?.registered
    ? `Device ${identity.deviceId} · organization ${identity.organizationId}${identity.tunnelHostname ? ` · ${identity.tunnelHostname}` : ""}`
    : "This device is not registered yet — run `mailwarden-bridge setup`";

  renderHealth(health, deviceLine);
  print();
  print(live ? "Daemon: running" : "Daemon: not reachable (this is a one-off local check)");
  return health.status === "online" ? 0 : 1;
}

async function commandDoctor(core: BridgeCore, argv: string[]): Promise<number> {
  const report = (await daemonFetch<BridgeDiagnosticReport>(core, "/diagnostics")) ?? (await core.diagnostics());
  if (hasFlag(argv, "--json")) {
    print(JSON.stringify(report, null, 2));
  } else {
    renderDiagnostics(report);
  }
  return report.overall === "healthy" ? 0 : 1;
}

async function commandStart(core: BridgeCore): Promise<number> {
  if (await systemdUnitInstalled(core)) {
    const result = await core.adapters.run(["systemctl", "start", BRIDGE_UNIT_NAME]);
    print(result.code === 0 ? `Started ${BRIDGE_UNIT_NAME}.` : result.stderr.trim() || "Failed to start the service.");
    return result.code;
  }
  print("No systemd unit installed; running the Bridge daemon in the foreground. Ctrl-C to stop.");
  const handle = await startDaemon(core);
  await new Promise<void>((resolve) => {
    const stop = () => void handle.stop().then(resolve);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

async function commandStop(core: BridgeCore): Promise<number> {
  if (await systemdUnitInstalled(core)) {
    const result = await core.adapters.run(["systemctl", "stop", BRIDGE_UNIT_NAME]);
    print(result.code === 0 ? `Stopped ${BRIDGE_UNIT_NAME}.` : result.stderr.trim() || "Failed to stop the service.");
    return result.code;
  }
  print("Bridge is not managed by systemd here; stop the foreground daemon with Ctrl-C.");
  return 1;
}

async function commandAccounts(core: BridgeCore, argv: string[]): Promise<number> {
  const live = await daemonFetch<{ accounts: Array<{ accountId: string; lastSuccessAt?: string; lastFailureAt?: string }>; summary: { configured: number; connected: number } }>(
    core,
    "/accounts"
  );
  if (!live) {
    print("The Bridge daemon is not running, so no account activity is available.");
    print("Account selection is per request: Cloud names the Proton account it wants on each call.");
    return 1;
  }
  if (hasFlag(argv, "--json")) {
    print(JSON.stringify(live, null, 2));
    return 0;
  }
  if (live.accounts.length === 0) {
    print("No Proton account has been served by this relay yet.");
    return 0;
  }
  for (const account of live.accounts) {
    print(`${account.accountId}  last ok: ${account.lastSuccessAt ?? "never"}  last error: ${account.lastFailureAt ?? "none"}`);
  }
  print();
  print(`${live.summary.connected} connected of ${live.summary.configured} seen in the last hour.`);
  return 0;
}

async function commandLogs(core: BridgeCore, argv: string[]): Promise<number> {
  const lines = argv.find((arg) => arg.startsWith("-n="))?.split("=")[1] ?? "100";
  if (await systemdUnitInstalled(core)) {
    const result = await core.adapters.run(["journalctl", "-u", BRIDGE_UNIT_NAME, "-n", lines, "--no-pager"], 30_000);
    print(result.stdout || result.stderr);
    return result.code;
  }
  print("Bridge is not managed by systemd here; the foreground daemon logs to stdout.");
  return 1;
}

async function commandRepair(core: BridgeCore, argv: string[]): Promise<number> {
  const action = argv[1] as BridgeRepairAction | undefined;
  if (!action || !BRIDGE_REPAIR_ACTIONS.includes(action)) {
    print(`Usage: mailwarden-bridge repair <${BRIDGE_REPAIR_ACTIONS.join("|")}>`);
    return 2;
  }
  // Prefer the daemon: it owns the running gateway and tunnel processes.
  const live = await daemonFetch<{ applied: boolean; detail: string }>(core, "/repair", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  const result = live ?? (await core.repair(action));
  print(`${result.applied ? "Repaired" : "Not repaired"}: ${result.detail}`);
  return result.applied ? 0 : 1;
}

async function commandService(core: BridgeCore, argv: string[]): Promise<number> {
  const sub = argv[1];
  if (sub === "install") {
    const plan = planSystemdInstall({
      execPath: process.execPath,
      daemonPath: new URL("./daemon.ts", import.meta.url).pathname,
      configDir: core.paths.configDir,
      stateDir: core.paths.stateDir,
    });
    print(`This installs ${plan.unitPath} and runs the following as root:`);
    for (const command of plan.commands) print(`  ${command}`);
    print();
    if (!hasFlag(argv, "--apply")) {
      print("Re-run with --apply to perform the install, or write the unit yourself:");
      print();
      print(plan.unitContents);
      return 0;
    }
    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      print("Refusing to install: re-run as root (sudo).");
      return 1;
    }
    await Bun.write(plan.unitPath, plan.unitContents);
    const reload = await core.adapters.run(["systemctl", "daemon-reload"]);
    if (reload.code !== 0) {
      print(reload.stderr.trim() || "systemctl daemon-reload failed");
      return reload.code;
    }
    print(`Installed ${plan.unitName}. Start it with: systemctl enable --now ${plan.unitName}`);
    return 0;
  }
  if (sub === "uninstall") {
    const plan = planSystemdUninstall();
    print("This removes the Bridge service and leaves credentials and Proton data in place:");
    for (const command of plan.commands) print(`  ${command}`);
    return 0;
  }
  print("Usage: mailwarden-bridge service <install|uninstall> [--apply]");
  return 2;
}

function usage(): void {
  print(`Mailwarden Bridge ${BRIDGE_VERSION}

Usage: mailwarden-bridge <command>

  setup [--cloud=URL] [--organization=ID]   Register this machine with Mailwarden Cloud
  status [--json]                           Relay status and component health
  doctor [--json]                           Explain what is wrong and who can fix it
  start                                     Start the daemon (systemd unit when installed)
  stop                                      Stop the daemon
  restart                                   Stop then start
  accounts [--json]                         Proton accounts this relay has served
  logs [-n=N]                               Bridge logs
  repair <action>                           Safe repair of one component
  service install|uninstall [--apply]       systemd integration for a headless server
  version                                   Print version and protocol
`);
}

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === "help" || command === "--help") {
    usage();
    return command ? 0 : 2;
  }
  if (command === "version" || command === "--version") {
    const core = await BridgeCore.create();
    print(JSON.stringify(core.version()));
    return 0;
  }

  const core = await BridgeCore.create();
  switch (command) {
    case "setup":
      return commandSetup(core, argv);
    case "status":
      return commandStatus(core, argv);
    case "doctor":
      return commandDoctor(core, argv);
    case "start":
      return commandStart(core);
    case "stop":
      return commandStop(core);
    case "restart": {
      await commandStop(core);
      return commandStart(core);
    }
    case "accounts":
      return commandAccounts(core, argv);
    case "logs":
      return commandLogs(core, argv);
    case "repair":
      return commandRepair(core, argv);
    case "service":
      return commandService(core, argv);
    default:
      print(`Unknown command: ${command}`);
      usage();
      return 2;
  }
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
