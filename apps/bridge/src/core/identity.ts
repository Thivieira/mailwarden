/**
 * Device identity: provisioning, persistence, renewal, and revocation.
 *
 * The device never holds an organization-wide secret. It exchanges a short-lived
 * browser authorization for a renewable, organization-scoped credential that an
 * admin can revoke on its own — and when Cloud says "revoked", the credential is
 * erased here rather than kept around for a retry.
 */
import type {
  RelayCapabilities,
  RelayDevice,
  RelayDeviceCredential,
  RelayHeartbeat,
  RelayHeartbeatResponse,
  BridgeHealth,
} from "@mailwarden/contracts";
import type { MailwardenCloudClient } from "./cloud";
import { CloudError } from "./cloud";
import type { SecretStore } from "./secrets";

export interface StoredIdentity {
  credential: RelayDeviceCredential;
  device: RelayDevice;
}

/** What is left behind after a revocation, so `status` can explain the state. */
export interface RevokedIdentityMarker {
  deviceId: string;
  organizationId: string;
  revokedAt: string;
}

interface IdentityRecord {
  credential?: RelayDeviceCredential;
  device?: RelayDevice;
  revoked?: RevokedIdentityMarker;
}

export interface ProvisioningPrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: string;
}

export interface ProvisionOptions {
  deviceName: string;
  platform: string;
  version: string;
  capabilities: RelayCapabilities;
  organizationId?: string;
  /** Called once, as soon as there is something for the human to open. */
  onPrompt?: (prompt: ProvisioningPrompt) => void;
  /** Injected for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const SECRET_KEY = "device.credential" as const;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DeviceIdentityManager {
  constructor(
    private readonly secrets: SecretStore,
    private readonly cloud: MailwardenCloudClient
  ) {}

  private async read(): Promise<IdentityRecord> {
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as IdentityRecord;
    } catch {
      return {};
    }
  }

  private async write(record: IdentityRecord): Promise<void> {
    await this.secrets.set(SECRET_KEY, JSON.stringify(record));
  }

  async load(): Promise<StoredIdentity | null> {
    const record = await this.read();
    if (!record.credential || !record.device) return null;
    return { credential: record.credential, device: record.device };
  }

  async revocation(): Promise<RevokedIdentityMarker | null> {
    return (await this.read()).revoked ?? null;
  }

  /** Erases secrets but keeps enough to explain the state to a human. */
  async markRevoked(now = () => Date.now()): Promise<void> {
    const record = await this.read();
    const credential = record.credential;
    await this.write({
      revoked: {
        deviceId: credential?.deviceId ?? record.revoked?.deviceId ?? "unknown",
        organizationId: credential?.organizationId ?? record.revoked?.organizationId ?? "unknown",
        revokedAt: new Date(now()).toISOString(),
      },
    });
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }

  /**
   * Runs the browser device-authorization flow to completion. Resolves only once
   * Cloud reports an outcome; the caller decides how long to wait.
   */
  async provision(options: ProvisionOptions): Promise<StoredIdentity> {
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;

    const start = await this.cloud.startProvisioning({
      deviceName: options.deviceName,
      platform: options.platform,
      version: options.version,
      capabilities: options.capabilities,
      organizationId: options.organizationId,
    });

    options.onPrompt?.({
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresAt: start.expiresAt,
    });

    const deadline = Date.parse(start.expiresAt);
    const intervalMs = Math.max(1, start.intervalSeconds) * 1000;

    for (;;) {
      const poll = await this.cloud.pollProvisioning(start.deviceCode);
      if (poll.state === "authorized") {
        if (!poll.credential || !poll.device) {
          throw new Error("Cloud authorized this device but returned no credential");
        }
        await this.write({ credential: poll.credential, device: poll.device });
        return { credential: poll.credential, device: poll.device };
      }
      if (poll.state === "denied") throw new Error(poll.reason || "Device authorization was denied");
      if (poll.state === "expired") throw new Error("Device authorization expired before it was approved");
      if (Number.isFinite(deadline) && now() > deadline) {
        throw new Error("Device authorization expired before it was approved");
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Sends one heartbeat and applies whatever Cloud answered: credential rotation
   * is persisted, revocation erases the credential.
   */
  async heartbeat(
    identity: StoredIdentity,
    heartbeat: RelayHeartbeat,
    health: BridgeHealth
  ): Promise<RelayHeartbeatResponse> {
    const response = await this.cloud.heartbeat(identity.credential, heartbeat, health);
    if (response.state === "revoked" || response.state === "unknown_device") {
      await this.markRevoked();
      return response;
    }
    if (response.credential) {
      await this.write({ credential: response.credential, device: identity.device });
    }
    return response;
  }

  /** True when the credential is expired or inside the last quarter of its life. */
  static needsRenewal(credential: RelayDeviceCredential, now = Date.now()): boolean {
    const issued = Date.parse(credential.issuedAt);
    const expires = Date.parse(credential.expiresAt);
    if (!Number.isFinite(expires)) return false;
    if (now >= expires) return true;
    if (!Number.isFinite(issued) || expires <= issued) return false;
    return now >= expires - (expires - issued) * 0.25;
  }

  async renewIfNeeded(identity: StoredIdentity, now = Date.now()): Promise<StoredIdentity> {
    if (!DeviceIdentityManager.needsRenewal(identity.credential, now)) return identity;
    try {
      const credential = await this.cloud.renewCredential(identity.credential);
      await this.write({ credential, device: identity.device });
      return { credential, device: identity.device };
    } catch (error) {
      if (error instanceof CloudError && error.code === "unauthorized") {
        await this.markRevoked();
        throw new Error("Device credential was rejected during renewal; this device must be registered again");
      }
      // A transient Cloud failure is not a reason to drop a still-valid credential.
      return identity;
    }
  }
}
