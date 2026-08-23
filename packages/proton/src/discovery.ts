/**
 * Proton Mail Bridge discovery.
 *
 * Mailwarden automates *around* official Proton Bridge; it never reimplements
 * Proton's cryptography and never tries to drive an interactive Proton login.
 * Everything here is observation only: is Bridge installed, which version, is it
 * listening, and can we reach its loopback IMAP/SMTP endpoints.
 *
 * All OS interaction goes through injected adapters so the state machine is
 * testable without a real Proton account or a real Bridge install.
 */

export type ProtonBridgeState =
  | "not_installed"
  | "stopped"
  | "running"
  | "unsupported_version"
  | "unknown";

export interface ProtonEndpointProbe {
  host: string;
  port: number;
  reachable: boolean;
}

export interface ProtonBridgeDiscovery {
  state: ProtonBridgeState;
  binaryPath?: string;
  version?: string;
  imap?: ProtonEndpointProbe;
  smtp?: ProtonEndpointProbe;
  /** Redacted, human-readable summary. Safe for logs and diagnostics bundles. */
  detail: string;
}

export interface ProtonDiscoveryAdapters {
  fileExists(path: string): Promise<boolean>;
  /** Resolves an executable on PATH, or null. */
  which(command: string): Promise<string | null>;
  run(command: string[], timeoutMs?: number): Promise<{ code: number; stdout: string; stderr: string }>;
  probeTcp(host: string, port: number, timeoutMs?: number): Promise<boolean>;
}

export interface ProtonDiscoveryOptions {
  platform?: NodeJS.Platform | string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  /** Extra binary path to try first, e.g. from local Bridge config. */
  binaryPathHint?: string;
}

/**
 * Bridge v3 is the line that exposes the loopback IMAP/SMTP behaviour Mailwarden
 * depends on. Anything older is reported as unsupported rather than guessed at.
 */
export const MINIMUM_PROTON_BRIDGE_VERSION = "3.0.0";

/**
 * Ordered candidates per platform. The bare `bridge` core binary is preferred on
 * Linux: unlike the GUI launcher it answers `--version` without trying to take
 * the single-instance lock of a Bridge that is already running.
 */
const BINARY_CANDIDATES: Record<string, string[]> = {
  linux: [
    "/usr/lib/protonmail/bridge/bridge",
    "/opt/protonmail/bridge/bridge",
    "/usr/bin/protonmail-bridge",
    "/usr/local/bin/protonmail-bridge",
  ],
  darwin: [
    "/Applications/Proton Mail Bridge.app/Contents/MacOS/bridge",
    "/Applications/ProtonMail Bridge.app/Contents/MacOS/bridge",
  ],
  win32: [
    "C:\\Program Files\\Proton AG\\Proton Mail Bridge\\bridge.exe",
    "C:\\Program Files\\Proton Technologies\\ProtonMail Bridge\\bridge.exe",
  ],
};

const PATH_COMMANDS = ["protonmail-bridge", "proton-bridge", "bridge"];

/** Extracts `3.25.0` from `Proton Mail Bridge 3.25.0`. */
export function parseProtonBridgeVersion(output: string): string | undefined {
  return /(\d+)\.(\d+)\.(\d+)/.exec(output)?.[0];
}

/** Numeric comparison of dotted versions; missing segments count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

async function findBinary(
  adapters: ProtonDiscoveryAdapters,
  options: ProtonDiscoveryOptions
): Promise<string | undefined> {
  const platform = String(options.platform ?? process.platform);
  const candidates = [
    ...(options.binaryPathHint ? [options.binaryPathHint] : []),
    ...(BINARY_CANDIDATES[platform] ?? []),
  ];
  for (const candidate of candidates) {
    if (await adapters.fileExists(candidate)) return candidate;
  }
  for (const command of PATH_COMMANDS) {
    const resolved = await adapters.which(command);
    if (resolved) return resolved;
  }
  return undefined;
}

export async function discoverProtonBridge(
  adapters: ProtonDiscoveryAdapters,
  options: ProtonDiscoveryOptions = {}
): Promise<ProtonBridgeDiscovery> {
  const imapHost = options.imapHost ?? "127.0.0.1";
  const imapPort = options.imapPort ?? 1143;
  const smtpHost = options.smtpHost ?? "127.0.0.1";
  const smtpPort = options.smtpPort ?? 1025;

  const binaryPath = await findBinary(adapters, options);

  const imapReachable = await adapters.probeTcp(imapHost, imapPort);
  const smtpReachable = await adapters.probeTcp(smtpHost, smtpPort);
  const imap: ProtonEndpointProbe = { host: imapHost, port: imapPort, reachable: imapReachable };
  const smtp: ProtonEndpointProbe = { host: smtpHost, port: smtpPort, reachable: smtpReachable };

  if (!binaryPath) {
    // A listening endpoint without a known binary still means a usable Bridge
    // (container, flatpak, custom install); report it honestly instead of
    // claiming "not installed" and sending the admin down the wrong path.
    if (imapReachable) {
      return {
        state: "running",
        imap,
        smtp,
        detail: `Proton Bridge binary not found, but IMAP is answering on ${imapHost}:${imapPort}`,
      };
    }
    return {
      state: "not_installed",
      imap,
      smtp,
      detail: "Proton Mail Bridge was not found in any known install location",
    };
  }

  let version: string | undefined;
  const probe = await adapters.run([binaryPath, "--version"], 10_000);
  if (probe.code === 0) version = parseProtonBridgeVersion(`${probe.stdout}\n${probe.stderr}`);

  if (version && compareVersions(version, MINIMUM_PROTON_BRIDGE_VERSION) < 0) {
    return {
      state: "unsupported_version",
      binaryPath,
      version,
      imap,
      smtp,
      detail: `Proton Bridge ${version} is older than the supported ${MINIMUM_PROTON_BRIDGE_VERSION} line`,
    };
  }

  if (imapReachable) {
    return {
      state: "running",
      binaryPath,
      version,
      imap,
      smtp,
      detail: version
        ? `Proton Bridge ${version} is running on ${imapHost}:${imapPort}`
        : `Proton Bridge is running on ${imapHost}:${imapPort}`,
    };
  }

  if (!version) {
    return {
      state: "unknown",
      binaryPath,
      imap,
      smtp,
      detail: `Found ${binaryPath} but could not read its version, and IMAP is not answering`,
    };
  }

  return {
    state: "stopped",
    binaryPath,
    version,
    imap,
    smtp,
    detail: `Proton Bridge ${version} is installed but nothing is listening on ${imapHost}:${imapPort}`,
  };
}
