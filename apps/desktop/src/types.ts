import type { BridgeHealth, BridgeVersion, RelayDevice, RelayStatus } from "@mailwarden/contracts";

/**
 * What the desktop shell shows. Every field is derived from what the local
 * Bridge daemon actually reported — there is no default "everything is fine"
 * state, because a companion that lies about health is worse than no companion.
 */
export type DesktopAppState =
  | "daemon_unreachable"
  | "pairing_device"
  | "revoked"
  | "connected_ready"
  | "degraded"
  | "offline";

export interface DesktopAccountSummary {
  /** Mailwarden mailbox id the relay served. Bridge never sees the address. */
  accountId: string;
  status: "online" | "error" | "idle";
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export interface DesktopBridgeState {
  appState: DesktopAppState;
  /** Why the shell is in this state, in plain language. */
  message: string;
  version?: BridgeVersion;
  deviceName?: string;
  organizationId?: string;
  device?: RelayDevice;
  relayStatus: RelayStatus;
  health?: BridgeHealth;
  cloud: { configured: boolean; reachable: boolean; endpoint?: string };
  protonBridge: { status: "running" | "stopped" | "unknown"; imapPort: number; smtpPort: number };
  accounts: DesktopAccountSummary[];
}

/** Raw shape of the Bridge daemon's `GET /v1/status`. */
export interface BridgeStatusResponse {
  version: BridgeVersion;
  deviceName: string;
  registered: boolean;
  revoked: boolean;
  deviceId?: string;
  organizationId?: string;
  device?: RelayDevice;
  tunnelHostname?: string;
  endpoint?: string;
  cloudBaseUrl: string;
  proton: { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number };
  health: BridgeHealth;
}
