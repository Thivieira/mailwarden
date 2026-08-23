import type { RelayStatus, RelayDevice, Workspace } from "@mailwarden/contracts";

export type DesktopAppState =
  | "unauthenticated"
  | "selecting_workspace"
  | "pairing_device"
  | "connected_ready"
  | "degraded"
  | "offline";

export interface DesktopAccountSummary {
  email: string;
  status: "online" | "syncing" | "error" | "needs_auth";
  lastSyncAt: string;
}

export interface DesktopBridgeState {
  appState: DesktopAppState;
  activeWorkspace?: Workspace;
  device?: RelayDevice;
  relayStatus: RelayStatus;
  cloudConnection: {
    status: "connected" | "connecting" | "disconnected";
    endpoint: string;
  };
  protonBridge: {
    status: "running" | "stopped" | "needs_auth";
    imapPort: number;
    smtpPort: number;
  };
  accounts: DesktopAccountSummary[];
  diagnosticsMessage?: string;
}
