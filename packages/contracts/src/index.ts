export type WorkspaceKind = "personal" | "team";
export type WorkspaceStatus = "active" | "suspended";
export type PlanId = "personal" | "team" | "enterprise";
export type MembershipRole = "owner" | "admin" | "member";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  plan: PlanId;
  createdAt: string;
}

export interface Organization extends Workspace {
  kind: "team";
}

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
}

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email?: string;
  role: Exclude<MembershipRole, "owner">;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface WorkspaceContext {
  userId: string;
  workspace: Workspace;
  membership: Membership;
}

export interface PlanCapabilities {
  canCreateOrganization: boolean;
  maxTeamOrganizations: number;
  maxOrganizationSeats: number;
  maxMailboxes: number;
  maxRelayDevices: number;
  sharedProtonRelay: boolean;
  sso: boolean;
}

export type ProviderType = "gmail" | "outlook" | "proton" | "mock";
export type MailboxProvider = ProviderType;
export type AccountStatus = "connected" | "disconnected" | "error" | "reauth_required";
export type MailboxStatus = AccountStatus;

export interface Mailbox {
  id: string;
  workspaceId: string;
  userId: string;
  provider: MailboxProvider;
  emailAddress: string;
  status: MailboxStatus;
}

export type RelayStatus = "provisioning" | "online" | "degraded" | "offline" | "needs_attention";

export interface RelayCapabilities {
  protonImap: boolean;
  protonSmtp: boolean;
  cloudflareTunnel: boolean;
}

export interface RelayDevice {
  id: string;
  organizationId: string;
  name: string;
  platform: string;
  version: string;
  protocolVersion: number;
  status: RelayStatus;
  createdBy: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  capabilities: RelayCapabilities;
  health?: BridgeHealth;
}

export interface RelayHeartbeat {
  deviceId: string;
  observedAt: string;
  status: RelayStatus;
  gatewayReachable: boolean;
  protonBridgeReachable: boolean;
  tunnelConnected: boolean;
  connectedAccountCount: number;
}

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Mailwarden Bridge (owner: Bridge branch; Platform reviews before integration)
// ---------------------------------------------------------------------------

/** Bridge build identity reported in heartbeats, health, and diagnostics. */
export interface BridgeVersion {
  /** Semantic version of the Bridge runtime. */
  version: string;
  /** Wire protocol version the device speaks to Cloud and to the gateway. */
  protocol: number;
  /** `linux-x64`, `darwin-arm64`, ... */
  platform: string;
}

/** Support level Mailwarden claims for a platform. Never claim more than is tested. */
export type BridgePlatformSupport = "supported" | "experimental" | "planned";

// --- Device provisioning ---------------------------------------------------
// Modelled on the OAuth 2.0 device authorization grant: the device never holds a
// permanent organization-wide secret, and the human authorizes in a browser.

export interface RelayProvisioningStartRequest {
  deviceName: string;
  platform: string;
  version: string;
  protocolVersion?: number;
  capabilities: RelayCapabilities;
  /** Optional hint; the human still selects the organization in the browser. */
  organizationId?: string;
}

export interface RelayProvisioningStartResponse {
  /** Opaque, single-use, short-lived. Kept out of logs and URLs. */
  deviceCode: string;
  /** Short human-typed code shown by the CLI/desktop. */
  userCode: string;
  verificationUri: string;
  /** `verificationUri` with the user code pre-filled. */
  verificationUriComplete?: string;
  expiresAt: string;
  intervalSeconds: number;
}

export type RelayProvisioningState = "pending" | "authorized" | "denied" | "expired";

export interface RelayProvisioningPollResponse {
  state: RelayProvisioningState;
  device?: RelayDevice;
  credential?: RelayDeviceCredential;
  /** Present when `state` is `denied`. */
  reason?: string;
}

/**
 * Renewable, organization-scoped device credential. Returned exactly once per
 * issue/rotation; the Bridge persists it through its secret store and never
 * writes it to config, logs, argv, or diagnostics bundles.
 */
export interface RelayDeviceCredential {
  deviceId: string;
  organizationId: string;
  /** Bearer secret the device presents to Cloud. */
  deviceSecret: string;
  /**
   * Secret Cloud presents (or signs with) when calling this device's gateway.
   * Per device, rotatable, revocable — replaces the deployment-wide gateway key.
   */
  gatewaySecret: string;
  issuedAt: string;
  expiresAt: string;
  /** Increments on every rotation; Cloud rejects stale generations. */
  generation: number;
}

// --- Heartbeat -------------------------------------------------------------

export type BridgeComponent =
  | "cloud"
  | "tunnel"
  | "gateway"
  | "protonBridge"
  | "accounts"
  | "deviceIdentity";

export type BridgeComponentStatus = "ok" | "degraded" | "down" | "unknown" | "needs_attention";

export interface BridgeComponentHealth {
  component: BridgeComponent;
  status: BridgeComponentStatus;
  /** Redacted, human-readable one-liner. Never contains secrets. */
  detail: string;
  checkedAt: string;
}

/** The one canonical Bridge health snapshot consumed by CLI, desktop, and Cloud. */
export interface BridgeHealth {
  status: RelayStatus;
  version: BridgeVersion;
  deviceId?: string;
  organizationId?: string;
  components: BridgeComponentHealth[];
  accounts: { connected: number; configured: number };
  observedAt: string;
  /**
   * Where this device believes Cloud can reach its gateway — normally the managed
   * tunnel hostname. Absent when the device has no reachable endpoint, which is
   * what makes Cloud-initiated diagnostics and repair unavailable rather than
   * silently simulated.
   */
  endpoint?: string;
}

export interface RelayHeartbeatResponse {
  /** `revoked` tells the device to erase its credential and stop relaying. */
  state: "ok" | "revoked" | "unknown_device";
  /** Present when Cloud rotated the credential during this heartbeat. */
  credential?: RelayDeviceCredential;
  /** Server-directed heartbeat interval. */
  nextHeartbeatSeconds?: number;
}

// --- Tunnel ----------------------------------------------------------------

/**
 * Scoped tunnel credential for one device. Cloud provisions the tunnel with its
 * own Cloudflare account token; that account token is never sent to a device.
 */
export interface RelayTunnelCredential {
  tunnelId: string;
  hostname: string;
  /** `cloudflared tunnel run --token` value. Secret-store only. */
  token: string;
  issuedAt: string;
}

// --- Diagnostics -----------------------------------------------------------

export type BridgeDiagnosticSeverity = "info" | "warning" | "error";

/** Who or what can fix a failing check. Drives the repair UX. */
export type BridgeRemediation =
  | "automatic"
  | "user_action"
  | "proton_login"
  | "administrator"
  | "none";

export interface BridgeDiagnostic {
  id: string;
  title: string;
  status: "pass" | "fail" | "skipped";
  severity: BridgeDiagnosticSeverity;
  /** Plain-language explanation of what was observed. Redacted. */
  explanation: string;
  /** What to do about it, when it failed. */
  remedy?: string;
  remediation: BridgeRemediation;
}

export interface BridgeDiagnosticReport {
  generatedAt: string;
  version: BridgeVersion;
  overall: "healthy" | "degraded" | "unhealthy";
  diagnostics: BridgeDiagnostic[];
}

/** Repair actions the Bridge will perform on itself. Never destructive to credentials. */
export type BridgeRepairAction =
  | "restart_gateway"
  | "restart_tunnel"
  | "refresh_registration"
  | "recheck_proton"
  | "fix_permissions";

/** The same list at runtime, so every surface validates against one vocabulary. */
export const BRIDGE_REPAIR_ACTIONS: BridgeRepairAction[] = [
  "restart_gateway",
  "restart_tunnel",
  "refresh_registration",
  "recheck_proton",
  "fix_permissions",
];

export interface BridgeRepairResult {
  action: BridgeRepairAction;
  applied: boolean;
  detail: string;
}
