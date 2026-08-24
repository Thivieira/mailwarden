/**
 * Desktop → Bridge daemon client.
 *
 * The companion talks to the local Bridge daemon over its authenticated loopback
 * API, using the same 0600 token file the CLI reads. It never parses CLI output,
 * never manages processes itself, and never invents a state: if the daemon is not
 * running, that is what the shell shows.
 */
import type { BridgeDiagnosticReport, BridgeRepairAction, BridgeRepairResult } from "@mailwarden/contracts";
import { readLocalApiToken } from "../../bridge/src/core/local-api";
import { resolveBridgePaths } from "../../bridge/src/core/paths";
import type { BridgeStatusResponse, DesktopAccountSummary, DesktopBridgeState } from "./types";

const UNREACHABLE: DesktopBridgeState = {
  appState: "daemon_unreachable",
  message:
    "The Mailwarden Bridge service is not running on this machine. Start it with `mailwarden-bridge start`.",
  relayStatus: "offline",
  cloud: { configured: false, reachable: false },
  protonBridge: { status: "unknown", imapPort: 0, smtpPort: 0 },
  accounts: [],
};

export class LocalBridgeClient {
  constructor(
    private readonly baseUrl = process.env.MAILWARDEN_BRIDGE_API || "http://127.0.0.1:8765",
    private readonly tokenFile = resolveBridgePaths().localApiTokenFile
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T | null> {
    const token = await readLocalApiToken(this.tokenFile);
    if (!token) return null;
    try {
      const response = await fetch(`${this.baseUrl}/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init?.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  async getStatus(): Promise<DesktopBridgeState> {
    const status = await this.request<BridgeStatusResponse>("/status");
    if (!status) return UNREACHABLE;

    const activity =
      (await this.request<{ accounts: DesktopAccountSummary[] }>("/accounts")) ?? { accounts: [] };
    const component = (name: string) => status.health.components.find((entry) => entry.component === name);

    const accounts: DesktopAccountSummary[] = (activity.accounts as any[]).map((entry) => ({
      accountId: entry.accountId,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      status: entry.lastSuccessAt ? "online" : entry.lastFailureAt ? "error" : "idle",
    }));

    return {
      appState: appStateFor(status),
      message: messageFor(status),
      version: status.version,
      deviceName: status.deviceName,
      organizationId: status.organizationId,
      device: status.device,
      relayStatus: status.health.status,
      health: status.health,
      cloud: {
        configured: Boolean(status.cloudBaseUrl),
        reachable: component("cloud")?.status === "ok",
        endpoint: status.cloudBaseUrl || undefined,
      },
      protonBridge: {
        status:
          component("protonBridge")?.status === "ok"
            ? "running"
            : component("protonBridge")?.status === "down"
              ? "stopped"
              : "unknown",
        imapPort: status.proton.imapPort,
        smtpPort: status.proton.smtpPort,
      },
      accounts,
    };
  }

  async getDiagnostics(): Promise<BridgeDiagnosticReport | null> {
    return this.request<BridgeDiagnosticReport>("/diagnostics");
  }

  async repair(action: BridgeRepairAction): Promise<BridgeRepairResult> {
    const result = await this.request<BridgeRepairResult>("/repair", {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    return (
      result ?? {
        action,
        applied: false,
        detail: "The Mailwarden Bridge service did not respond, so nothing was repaired.",
      }
    );
  }
}

function appStateFor(status: BridgeStatusResponse): DesktopBridgeState["appState"] {
  if (status.revoked) return "revoked";
  if (!status.registered) return "pairing_device";
  if (status.health.status === "online") return "connected_ready";
  if (status.health.status === "offline") return "offline";
  return "degraded";
}

function messageFor(status: BridgeStatusResponse): string {
  if (status.revoked) {
    return "This device's registration was revoked. Run `mailwarden-bridge setup` to register it again.";
  }
  if (!status.registered) {
    return "This device is not paired yet. Run `mailwarden-bridge setup` and approve the code in Mailwarden.";
  }
  const attention = status.health.components.filter(
    (entry) => entry.status === "down" || entry.status === "needs_attention"
  );
  if (attention.length > 0) return attention.map((entry) => entry.detail).join(" · ");
  return "Relay is healthy.";
}

export const localBridgeClient = new LocalBridgeClient();
