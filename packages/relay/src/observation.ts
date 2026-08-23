/**
 * Bridge health and diagnostics.
 *
 * The daemon/CLI collects one `BridgeObservation` of plain facts through IO, and
 * everything a human or a UI sees is derived from it by the pure functions here.
 * That keeps interpretation in Bridge Core: the desktop shell never parses
 * command output, and the rules are testable without a Proton account, a tunnel,
 * or a Cloud endpoint.
 */
import type {
  BridgeComponentHealth,
  BridgeDiagnostic,
  BridgeDiagnosticReport,
  BridgeHealth,
  BridgeVersion,
  RelayStatus,
} from "@mailwarden/contracts";
import type { ProtonBridgeDiscovery } from "@mailwarden/proton";

export interface BridgeIdentityObservation {
  deviceId: string;
  organizationId: string;
  /** Cloud told us this device is no longer trusted. */
  revoked: boolean;
  expiresAt?: string;
  generation: number;
}

export interface BridgeObservation {
  version: BridgeVersion;
  observedAt: string;
  /** Absent until the device has been provisioned. */
  identity?: BridgeIdentityObservation;
  cloud: { configured: boolean; reachable: boolean; detail: string };
  gateway: { listening: boolean; port: number; portConflict: boolean; detail: string };
  proton: ProtonBridgeDiscovery;
  tunnel: {
    /** Mailwarden only manages the tunnel when it holds a scoped credential. */
    managed: boolean;
    installed: boolean;
    credentialPresent: boolean;
    running: boolean;
    ready: boolean;
    hostname?: string;
    detail: string;
  };
  secrets: { backend: string; secure: boolean; permissionsOk: boolean; detail: string };
  accounts: { configured: number; connected: number };
}

function health(
  component: BridgeComponentHealth["component"],
  status: BridgeComponentHealth["status"],
  detail: string,
  checkedAt: string
): BridgeComponentHealth {
  return { component, status, detail, checkedAt };
}

export function buildComponentHealth(observation: BridgeObservation): BridgeComponentHealth[] {
  const at = observation.observedAt;
  const components: BridgeComponentHealth[] = [];

  if (!observation.identity) {
    components.push(health("deviceIdentity", "needs_attention", "Device is not registered with Mailwarden Cloud", at));
  } else if (observation.identity.revoked) {
    components.push(health("deviceIdentity", "down", "Device registration was revoked by an organization admin", at));
  } else {
    components.push(
      health("deviceIdentity", "ok", `Registered as device ${observation.identity.deviceId}`, at)
    );
  }

  if (!observation.cloud.configured) {
    components.push(health("cloud", "unknown", "No Mailwarden Cloud endpoint configured", at));
  } else {
    components.push(
      health("cloud", observation.cloud.reachable ? "ok" : "down", observation.cloud.detail, at)
    );
  }

  components.push(
    health(
      "gateway",
      observation.gateway.listening ? "ok" : observation.gateway.portConflict ? "needs_attention" : "down",
      observation.gateway.detail,
      at
    )
  );

  const protonStatus: BridgeComponentHealth["status"] =
    observation.proton.state === "running"
      ? "ok"
      : observation.proton.state === "unknown"
        ? "unknown"
        : observation.proton.state === "stopped"
          ? "down"
          : "needs_attention";
  components.push(health("protonBridge", protonStatus, observation.proton.detail, at));

  if (!observation.tunnel.managed) {
    components.push(health("tunnel", "unknown", "Tunnel is managed outside Mailwarden Bridge", at));
  } else if (!observation.tunnel.installed) {
    components.push(health("tunnel", "needs_attention", "cloudflared is not installed", at));
  } else {
    components.push(
      health("tunnel", observation.tunnel.ready ? "ok" : observation.tunnel.running ? "degraded" : "down", observation.tunnel.detail, at)
    );
  }

  const { configured, connected } = observation.accounts;
  components.push(
    health(
      "accounts",
      configured === 0 ? "unknown" : connected === configured ? "ok" : connected === 0 ? "down" : "degraded",
      configured === 0 ? "No Proton accounts configured yet" : `${connected} of ${configured} accounts connected`,
      at
    )
  );

  return components;
}

/** Collapses component health into the single status Cloud and the UI show. */
export function aggregateRelayStatus(components: BridgeComponentHealth[]): RelayStatus {
  const byComponent = new Map(components.map((entry) => [entry.component, entry]));
  const identity = byComponent.get("deviceIdentity");

  if (identity?.status === "down") return "needs_attention";
  if (identity?.status === "needs_attention") return "provisioning";

  const gateway = byComponent.get("gateway");
  const tunnel = byComponent.get("tunnel");
  if (gateway?.status === "down" || tunnel?.status === "down") return "offline";
  if (components.some((entry) => entry.status === "needs_attention")) return "needs_attention";
  if (components.some((entry) => entry.status === "degraded" || entry.status === "down")) return "degraded";
  return "online";
}

export function buildHealth(observation: BridgeObservation): BridgeHealth {
  const components = buildComponentHealth(observation);
  return {
    status: aggregateRelayStatus(components),
    version: observation.version,
    deviceId: observation.identity?.deviceId,
    organizationId: observation.identity?.organizationId,
    components,
    accounts: { connected: observation.accounts.connected, configured: observation.accounts.configured },
    observedAt: observation.observedAt,
  };
}

function pass(id: string, title: string, explanation: string): BridgeDiagnostic {
  return { id, title, status: "pass", severity: "info", explanation, remediation: "none" };
}

function fail(
  id: string,
  title: string,
  severity: BridgeDiagnostic["severity"],
  explanation: string,
  remedy: string,
  remediation: BridgeDiagnostic["remediation"]
): BridgeDiagnostic {
  return { id, title, status: "fail", severity, explanation, remedy, remediation };
}

/**
 * Explains failures in cause order — identity, Cloud, secrets, Proton, gateway,
 * tunnel — so `doctor` names the broken edge instead of listing symptoms.
 */
export function buildDiagnostics(observation: BridgeObservation): BridgeDiagnostic[] {
  const diagnostics: BridgeDiagnostic[] = [];

  if (!observation.identity) {
    diagnostics.push(
      fail(
        "device.identity.missing",
        "Device identity",
        "error",
        "This machine has no Mailwarden device identity yet.",
        "Run `mailwarden-bridge setup` and authorize the device in the browser.",
        "user_action"
      )
    );
  } else if (observation.identity.revoked) {
    diagnostics.push(
      fail(
        "device.identity.revoked",
        "Device identity",
        "error",
        "An organization admin revoked this device's registration, so Cloud rejects it.",
        "Run `mailwarden-bridge setup` to register this machine again.",
        "user_action"
      )
    );
  } else {
    diagnostics.push(
      pass("device.identity", "Device identity", `Registered as device ${observation.identity.deviceId}.`)
    );
  }

  if (!observation.cloud.configured) {
    diagnostics.push(
      fail(
        "cloud.unconfigured",
        "Mailwarden Cloud",
        "error",
        "No Mailwarden Cloud endpoint is configured.",
        "Set `cloudBaseUrl` in the Bridge config, or run `mailwarden-bridge setup`.",
        "user_action"
      )
    );
  } else if (!observation.cloud.reachable) {
    diagnostics.push(
      fail(
        "cloud.unreachable",
        "Mailwarden Cloud",
        "error",
        observation.cloud.detail,
        "Check outbound HTTPS from this host, then run `mailwarden-bridge doctor` again.",
        "administrator"
      )
    );
  } else {
    diagnostics.push(pass("cloud.reachable", "Mailwarden Cloud", observation.cloud.detail));
  }

  if (!observation.secrets.secure) {
    diagnostics.push(
      fail(
        "secrets.backend",
        "Credential storage",
        "warning",
        observation.secrets.detail,
        "Install a Secret Service provider (or Pass) for the Bridge service user to hold credentials in the OS keyring.",
        "administrator"
      )
    );
  } else if (!observation.secrets.permissionsOk) {
    diagnostics.push(
      fail(
        "secrets.permissions",
        "Credential storage",
        "error",
        "Bridge credential files are readable by other users on this host.",
        "Run `mailwarden-bridge repair fix_permissions`.",
        "automatic"
      )
    );
  } else {
    diagnostics.push(pass("secrets.ok", "Credential storage", observation.secrets.detail));
  }

  switch (observation.proton.state) {
    case "running":
      diagnostics.push(pass("proton.running", "Proton Bridge", observation.proton.detail));
      break;
    case "not_installed":
      diagnostics.push(
        fail(
          "proton.not_installed",
          "Proton Bridge",
          "error",
          observation.proton.detail,
          "Install official Proton Mail Bridge and sign in to each paid Proton account.",
          "proton_login"
        )
      );
      break;
    case "stopped":
      diagnostics.push(
        fail(
          "proton.stopped",
          "Proton Bridge",
          "error",
          observation.proton.detail,
          "Start Proton Bridge (`systemctl start proton-bridge` on the reference server) and confirm it reports its IMAP port.",
          "administrator"
        )
      );
      break;
    case "unsupported_version":
      diagnostics.push(
        fail(
          "proton.unsupported_version",
          "Proton Bridge",
          "warning",
          observation.proton.detail,
          "Update Proton Mail Bridge to a current 3.x release.",
          "administrator"
        )
      );
      break;
    default:
      diagnostics.push(
        fail(
          "proton.unknown",
          "Proton Bridge",
          "warning",
          observation.proton.detail,
          "Confirm which IMAP/SMTP ports Proton Bridge reports and update the Bridge config to match.",
          "administrator"
        )
      );
  }

  if (observation.gateway.portConflict) {
    diagnostics.push(
      fail(
        "gateway.port_conflict",
        "Mailwarden Gateway",
        "error",
        `Port ${observation.gateway.port} is already in use by another process.`,
        "Change `gatewayPort` in the Bridge config or stop the conflicting service.",
        "administrator"
      )
    );
  } else if (!observation.gateway.listening) {
    diagnostics.push(
      fail(
        "gateway.down",
        "Mailwarden Gateway",
        "error",
        observation.gateway.detail,
        "Run `mailwarden-bridge repair restart_gateway`.",
        "automatic"
      )
    );
  } else {
    diagnostics.push(pass("gateway.listening", "Mailwarden Gateway", observation.gateway.detail));
  }

  if (!observation.tunnel.managed) {
    diagnostics.push(
      pass("tunnel.unmanaged", "Cloudflare Tunnel", "Tunnel is managed outside Mailwarden Bridge.")
    );
  } else if (!observation.tunnel.installed) {
    diagnostics.push(
      fail(
        "tunnel.cloudflared_missing",
        "Cloudflare Tunnel",
        "error",
        "cloudflared is not installed on this host.",
        "Install cloudflared using Cloudflare's documented package workflow.",
        "administrator"
      )
    );
  } else if (!observation.tunnel.credentialPresent) {
    diagnostics.push(
      fail(
        "tunnel.credential_missing",
        "Cloudflare Tunnel",
        "error",
        "This device has no scoped tunnel credential from Mailwarden Cloud.",
        "Run `mailwarden-bridge setup` to request a managed relay tunnel.",
        "user_action"
      )
    );
  } else if (!observation.tunnel.ready) {
    diagnostics.push(
      fail(
        "tunnel.not_ready",
        "Cloudflare Tunnel",
        "error",
        observation.tunnel.detail,
        "Run `mailwarden-bridge repair restart_tunnel`.",
        "automatic"
      )
    );
  } else {
    diagnostics.push(pass("tunnel.ready", "Cloudflare Tunnel", observation.tunnel.detail));
  }

  return diagnostics;
}

export function buildDiagnosticReport(observation: BridgeObservation): BridgeDiagnosticReport {
  const diagnostics = buildDiagnostics(observation);
  const failed = diagnostics.filter((entry) => entry.status === "fail");
  return {
    generatedAt: observation.observedAt,
    version: observation.version,
    overall: failed.some((entry) => entry.severity === "error")
      ? "unhealthy"
      : failed.length > 0
        ? "degraded"
        : "healthy",
    diagnostics,
  };
}
