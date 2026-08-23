/**
 * Bridge → Mailwarden Cloud client.
 *
 * Platform (Sol) owns the endpoints; this file owns the shape the Bridge expects
 * and is the single place to change when the real API lands. Until then the
 * development adapter below keeps the whole device lifecycle runnable end to end.
 */
import type {
  BridgeHealth,
  RelayDeviceCredential,
  RelayHeartbeat,
  RelayHeartbeatResponse,
  RelayProvisioningPollResponse,
  RelayProvisioningStartRequest,
  RelayProvisioningStartResponse,
  RelayTunnelCredential,
} from "@mailwarden/contracts";

/** Wire protocol version sent on every Cloud request. */
export const BRIDGE_PROTOCOL_VERSION = 1;

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "cloud_error"
  ) {
    super(message);
    this.name = "CloudError";
  }
}

export interface MailwardenCloudClient {
  readonly baseUrl: string;
  /** Cheap reachability probe for health and diagnostics. */
  ping(): Promise<{ reachable: boolean; detail: string }>;
  startProvisioning(request: RelayProvisioningStartRequest): Promise<RelayProvisioningStartResponse>;
  pollProvisioning(deviceCode: string): Promise<RelayProvisioningPollResponse>;
  heartbeat(
    credential: RelayDeviceCredential,
    heartbeat: RelayHeartbeat,
    health: BridgeHealth
  ): Promise<RelayHeartbeatResponse>;
  renewCredential(credential: RelayDeviceCredential): Promise<RelayDeviceCredential>;
  /** Returns null when the organization has no managed tunnel for this device. */
  fetchTunnelCredential(credential: RelayDeviceCredential): Promise<RelayTunnelCredential | null>;
}

/**
 * Endpoints expected from Platform. Kept in one table so the handoff and the
 * implementation cannot drift apart.
 */
export const CLOUD_ROUTES = {
  provisioningStart: "/api/bridge/v1/provisioning/start",
  provisioningPoll: "/api/bridge/v1/provisioning/poll",
  heartbeat: "/api/bridge/v1/devices/heartbeat",
  renew: "/api/bridge/v1/devices/credential/renew",
  tunnel: "/api/bridge/v1/devices/tunnel",
  health: "/api/health",
} as const;

export class HttpCloudClient implements MailwardenCloudClient {
  constructor(
    readonly baseUrl: string,
    private readonly timeoutMs = 15_000
  ) {}

  private url(route: string): string {
    return new URL(route, this.baseUrl).toString();
  }

  private async request<T>(route: string, init: RequestInit & { deviceSecret?: string } = {}): Promise<T> {
    const { deviceSecret, ...rest } = init;
    let response: Response;
    try {
      response = await fetch(this.url(route), {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          "X-Mailwarden-Bridge-Protocol": String(BRIDGE_PROTOCOL_VERSION),
          ...(deviceSecret ? { Authorization: `Bearer ${deviceSecret}` } : {}),
          ...(rest.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Never include the request body or headers: they carry device secrets.
      throw new CloudError(
        `Mailwarden Cloud is unreachable at ${this.baseUrl}: ${error instanceof Error ? error.name : "network error"}`,
        0,
        "unreachable"
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudError("Mailwarden Cloud rejected this device's credential", response.status, "unauthorized");
    }
    if (!response.ok) {
      throw new CloudError(`Mailwarden Cloud returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  async ping(): Promise<{ reachable: boolean; detail: string }> {
    try {
      const response = await fetch(this.url(CLOUD_ROUTES.health), { signal: AbortSignal.timeout(this.timeoutMs) });
      return response.ok
        ? { reachable: true, detail: `Cloud reachable at ${this.baseUrl}` }
        : { reachable: false, detail: `Cloud returned ${response.status} at ${this.baseUrl}` };
    } catch {
      return { reachable: false, detail: `Cloud is unreachable at ${this.baseUrl}` };
    }
  }

  startProvisioning(request: RelayProvisioningStartRequest): Promise<RelayProvisioningStartResponse> {
    return this.request(CLOUD_ROUTES.provisioningStart, { method: "POST", body: JSON.stringify(request) });
  }

  pollProvisioning(deviceCode: string): Promise<RelayProvisioningPollResponse> {
    return this.request(CLOUD_ROUTES.provisioningPoll, { method: "POST", body: JSON.stringify({ deviceCode }) });
  }

  async heartbeat(
    credential: RelayDeviceCredential,
    heartbeat: RelayHeartbeat,
    health: BridgeHealth
  ): Promise<RelayHeartbeatResponse> {
    try {
      return await this.request<RelayHeartbeatResponse>(CLOUD_ROUTES.heartbeat, {
        method: "POST",
        deviceSecret: credential.deviceSecret,
        body: JSON.stringify({ heartbeat, health, generation: credential.generation }),
      });
    } catch (error) {
      // A rejected credential is a protocol answer, not a transport failure: the
      // daemon must react by erasing local credentials rather than retrying.
      if (error instanceof CloudError && error.code === "unauthorized") return { state: "revoked" };
      throw error;
    }
  }

  renewCredential(credential: RelayDeviceCredential): Promise<RelayDeviceCredential> {
    return this.request(CLOUD_ROUTES.renew, {
      method: "POST",
      deviceSecret: credential.deviceSecret,
      body: JSON.stringify({ deviceId: credential.deviceId, generation: credential.generation }),
    });
  }

  async fetchTunnelCredential(credential: RelayDeviceCredential): Promise<RelayTunnelCredential | null> {
    try {
      return await this.request<RelayTunnelCredential>(CLOUD_ROUTES.tunnel, {
        method: "POST",
        deviceSecret: credential.deviceSecret,
        body: JSON.stringify({ deviceId: credential.deviceId }),
      });
    } catch (error) {
      if (error instanceof CloudError && error.status === 404) return null;
      throw error;
    }
  }
}

export interface DevCloudOptions {
  /** Seconds the fake authorization stays pending, so setup UX can be exercised. */
  pendingSeconds?: number;
  organizationId?: string;
  hostname?: string;
  now?: () => number;
}

/**
 * Development adapter used while Platform's endpoints are unfinished, and by the
 * tests. It implements the same state machine — pending, authorized, rotation,
 * revocation — entirely in memory. It issues throwaway secrets and must never be
 * selected when a real `cloudBaseUrl` is configured.
 */
export class DevCloudClient implements MailwardenCloudClient {
  readonly baseUrl = "dev://mailwarden-cloud";
  private readonly pending = new Map<string, { authorizedAt: number; deviceName: string }>();
  private readonly devices = new Map<string, RelayDeviceCredential>();
  private readonly revoked = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: DevCloudOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async ping() {
    return { reachable: true, detail: "Development Cloud adapter (no real Mailwarden Cloud configured)" };
  }

  async startProvisioning(request: RelayProvisioningStartRequest): Promise<RelayProvisioningStartResponse> {
    const deviceCode = `dev_${crypto.randomUUID()}`;
    const pendingSeconds = this.options.pendingSeconds ?? 0;
    this.pending.set(deviceCode, {
      authorizedAt: this.now() + pendingSeconds * 1000,
      deviceName: request.deviceName,
    });
    const userCode = `DEV-${Math.floor(1000 + Math.random() * 8999)}`;
    return {
      deviceCode,
      userCode,
      verificationUri: "https://mailwarden.app/bridge/authorize",
      verificationUriComplete: `https://mailwarden.app/bridge/authorize?code=${userCode}`,
      expiresAt: new Date(this.now() + 10 * 60_000).toISOString(),
      intervalSeconds: 2,
    };
  }

  async pollProvisioning(deviceCode: string): Promise<RelayProvisioningPollResponse> {
    const entry = this.pending.get(deviceCode);
    if (!entry) return { state: "expired" };
    if (this.now() < entry.authorizedAt) return { state: "pending" };
    this.pending.delete(deviceCode);

    const deviceId = `relaydev_${crypto.randomUUID().slice(0, 8)}`;
    const organizationId = this.options.organizationId ?? "org_dev";
    const credential = this.issue(deviceId, organizationId, 1);
    return {
      state: "authorized",
      device: {
        id: deviceId,
        organizationId,
        name: entry.deviceName,
        platform: process.platform,
        version: "dev",
        protocolVersion: 1,
        status: "provisioning",
        createdBy: "dev-user",
        createdAt: new Date(this.now()).toISOString(),
        capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
      },
      credential,
    };
  }

  private issue(deviceId: string, organizationId: string, generation: number): RelayDeviceCredential {
    const credential: RelayDeviceCredential = {
      deviceId,
      organizationId,
      deviceSecret: `devsec_${crypto.randomUUID()}`,
      gatewaySecret: `devgw_${crypto.randomUUID()}`,
      issuedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + 30 * 24 * 3600_000).toISOString(),
      generation,
    };
    this.devices.set(deviceId, credential);
    return credential;
  }

  /** Test/dev hook: simulate an admin revoking the device in the portal. */
  revoke(deviceId: string): void {
    this.revoked.add(deviceId);
  }

  async heartbeat(credential: RelayDeviceCredential): Promise<RelayHeartbeatResponse> {
    if (this.revoked.has(credential.deviceId)) return { state: "revoked" };
    const known = this.devices.get(credential.deviceId);
    if (!known || known.deviceSecret !== credential.deviceSecret) return { state: "unknown_device" };
    return { state: "ok", nextHeartbeatSeconds: 60 };
  }

  async renewCredential(credential: RelayDeviceCredential): Promise<RelayDeviceCredential> {
    if (this.revoked.has(credential.deviceId)) throw new CloudError("Device revoked", 403, "unauthorized");
    return this.issue(credential.deviceId, credential.organizationId, credential.generation + 1);
  }

  async fetchTunnelCredential(credential: RelayDeviceCredential): Promise<RelayTunnelCredential | null> {
    if (this.revoked.has(credential.deviceId)) return null;
    return {
      tunnelId: `dev-tunnel-${credential.deviceId}`,
      hostname: this.options.hostname ?? `${credential.deviceId}.relay.mailwarden.app`,
      token: `devtunnel_${crypto.randomUUID()}`,
      issuedAt: new Date(this.now()).toISOString(),
    };
  }
}

export function createCloudClient(baseUrl: string): MailwardenCloudClient {
  if (!baseUrl || baseUrl.startsWith("dev://")) return new DevCloudClient();
  return new HttpCloudClient(baseUrl);
}
