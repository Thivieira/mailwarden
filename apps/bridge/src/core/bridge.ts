/**
 * Bridge Core.
 *
 * One object that owns the whole relay lifecycle — configuration, secrets, device
 * identity, the Proton Gateway, Proton Bridge discovery, the Cloudflare Tunnel,
 * health, diagnostics and repair — so the daemon, the CLI and (later) the desktop
 * shell are thin entrypoints over the same behaviour instead of three
 * reimplementations of it.
 */
import { hostname, platform, arch } from "node:os";
import { chmod, mkdir } from "node:fs/promises";
import type {
  BridgeDiagnosticReport,
  BridgeHealth,
  BridgeRepairAction,
  BridgeRepairResult,
  BridgeVersion,
  RelayCapabilities,
  RelayHeartbeat,
  RelayTunnelCredential,
} from "@mailwarden/contracts";
import { discoverProtonBridge, type ProtonBridgeDiscovery } from "@mailwarden/proton";
import {
  buildDiagnosticReport,
  buildHealth,
  type BridgeObservation,
} from "@mailwarden/relay";
import { AccountActivityTracker } from "./accounts";
import { createCloudClient, type MailwardenCloudClient } from "./cloud";
import { loadBridgeConfig, saveBridgeConfig, type BridgeConfig } from "./config";
import { startGateway, type RunningGateway } from "./gateway";
import { DeviceIdentityManager, type ProvisioningPrompt, type StoredIdentity } from "./identity";
import { createLogger, type BridgeLogger } from "./log";
import { resolveBridgePaths, type BridgePaths } from "./paths";
import { createSecretStore, type SecretStore } from "./secrets";
import { systemAdapters, type SystemAdapters } from "./system";
import { TunnelManager } from "./tunnel";

export const BRIDGE_VERSION = "0.1.0";
export const BRIDGE_PROTOCOL = 1;

export const BRIDGE_CAPABILITIES: RelayCapabilities = {
  protonImap: true,
  protonSmtp: true,
  cloudflareTunnel: true,
};

export interface BridgeCoreOptions {
  paths?: BridgePaths;
  config?: BridgeConfig;
  secrets?: SecretStore;
  cloud?: MailwardenCloudClient;
  adapters?: SystemAdapters;
  logger?: BridgeLogger;
}

export class BridgeCore {
  readonly accounts = new AccountActivityTracker();
  private gateway: RunningGateway | null = null;

  private constructor(
    readonly paths: BridgePaths,
    public config: BridgeConfig,
    readonly secrets: SecretStore,
    readonly cloud: MailwardenCloudClient,
    readonly identity: DeviceIdentityManager,
    readonly tunnel: TunnelManager,
    readonly adapters: SystemAdapters,
    readonly log: BridgeLogger
  ) {}

  static async create(options: BridgeCoreOptions = {}): Promise<BridgeCore> {
    const paths = options.paths ?? resolveBridgePaths();
    const adapters = options.adapters ?? systemAdapters;
    const config = options.config ?? (await loadBridgeConfig(paths, hostname()));
    const log = options.logger ?? createLogger(config.logLevel);
    const secrets = options.secrets ?? (await createSecretStore(paths, adapters));
    const cloud = options.cloud ?? createCloudClient(config.cloudBaseUrl);
    const identity = new DeviceIdentityManager(secrets, cloud);
    const tunnel = new TunnelManager({
      adapters,
      metricsAddress: config.tunnel.metricsAddress,
      cloudflaredPath: config.tunnel.cloudflaredPath,
      logger: log,
    });
    return new BridgeCore(paths, config, secrets, cloud, identity, tunnel, adapters, log);
  }

  version(): BridgeVersion {
    return { version: BRIDGE_VERSION, protocol: BRIDGE_PROTOCOL, platform: `${platform()}-${arch()}` };
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Runs first-time setup: browser device authorization, organization-scoped
   * credential, and a managed tunnel credential when the organization has one.
   */
  async setup(options: { onPrompt?: (prompt: ProvisioningPrompt) => void; organizationId?: string } = {}): Promise<StoredIdentity> {
    const version = this.version();
    const stored = await this.identity.provision({
      deviceName: this.config.deviceName,
      platform: version.platform,
      version: version.version,
      capabilities: BRIDGE_CAPABILITIES,
      organizationId: options.organizationId,
      onPrompt: options.onPrompt,
    });

    const tunnelCredential = await this.cloud.fetchTunnelCredential(stored.credential).catch(() => null);
    if (tunnelCredential) await this.storeTunnelCredential(tunnelCredential);

    await saveBridgeConfig(this.paths, this.config);
    return stored;
  }

  async storeTunnelCredential(credential: RelayTunnelCredential): Promise<void> {
    await this.secrets.set("tunnel.credential", JSON.stringify(credential));
    this.config = {
      ...this.config,
      tunnel: { ...this.config.tunnel, managed: true, hostname: credential.hostname },
    };
    await saveBridgeConfig(this.paths, this.config);
  }

  async tunnelCredential(): Promise<RelayTunnelCredential | null> {
    const raw = await this.secrets.get("tunnel.credential");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RelayTunnelCredential;
    } catch {
      return null;
    }
  }

  async startGateway(): Promise<RunningGateway> {
    if (this.gateway) return this.gateway;
    this.gateway = startGateway({
      host: this.config.gateway.host,
      port: this.config.gateway.port,
      proton: {
        imapHost: this.config.proton.imapHost,
        imapPort: this.config.proton.imapPort,
        smtpHost: this.config.proton.smtpHost,
        smtpPort: this.config.proton.smtpPort,
        username: process.env.PROTON_BRIDGE_USERNAME,
        password: process.env.PROTON_BRIDGE_PASSWORD,
      },
      secrets: async () => {
        const stored = await this.identity.load();
        return {
          deviceSecret: stored?.credential.gatewaySecret ?? null,
          legacySharedKey: process.env.PROTON_GATEWAY_API_KEY ?? null,
        };
      },
      maxRequestBytes: this.config.gateway.maxRequestBytes,
      requestsPerMinute: this.config.gateway.requestsPerMinute,
      logger: this.log,
      onAccountActivity: (accountId, ok) => this.accounts.record(accountId, ok),
    });
    this.log("info", "Proton gateway listening on loopback", { port: this.gateway.port });
    return this.gateway;
  }

  async stopGateway(): Promise<void> {
    if (!this.gateway) return;
    await this.gateway.stop();
    this.gateway = null;
  }

  async startTunnel(): Promise<void> {
    if (!this.config.tunnel.managed) return;
    const credential = await this.tunnelCredential();
    if (!credential) {
      this.log("warn", "Tunnel is marked managed but no scoped tunnel credential is stored");
      return;
    }
    await this.tunnel.start(credential);
  }

  // --- observation ---------------------------------------------------------

  async discoverProton(): Promise<ProtonBridgeDiscovery> {
    return discoverProtonBridge(this.adapters, {
      imapHost: this.config.proton.imapHost,
      imapPort: this.config.proton.imapPort,
      smtpHost: this.config.proton.smtpHost,
      smtpPort: this.config.proton.smtpPort,
      binaryPathHint: this.config.proton.binaryPath,
    });
  }

  /**
   * Distinguishes "our gateway is up" from "something else holds the port" by
   * asking the port whether it answers as a Mailwarden gateway.
   */
  private async probeGateway(): Promise<{ listening: boolean; portConflict: boolean; detail: string }> {
    const { host, port } = this.config.gateway;
    if (this.gateway) return { listening: true, portConflict: false, detail: `Gateway listening on ${host}:${port}` };

    const open = await this.adapters.probeTcp(host, port, 1_500);
    if (!open) return { listening: false, portConflict: false, detail: `Nothing is listening on ${host}:${port}` };

    try {
      const response = await fetch(`http://${host}:${port}/v1/health`, { signal: AbortSignal.timeout(2_000) });
      // 401 still identifies a Mailwarden gateway: it answered the route.
      const mailwarden = response.status === 401 || response.headers.get("content-type")?.includes("application/json");
      return mailwarden
        ? { listening: true, portConflict: false, detail: `Gateway answering on ${host}:${port}` }
        : { listening: false, portConflict: true, detail: `Port ${port} is held by another service` };
    } catch {
      return { listening: false, portConflict: true, detail: `Port ${port} is held by another service` };
    }
  }

  async observe(): Promise<BridgeObservation> {
    const observedAt = new Date().toISOString();
    const stored = await this.identity.load();
    const revoked = stored ? null : await this.identity.revocation();
    const cloudPing = this.config.cloudBaseUrl
      ? await this.cloud.ping()
      : { reachable: false, detail: "No Mailwarden Cloud endpoint configured" };
    const secretsAudit = await this.secrets.audit();
    const tunnelStatus = await this.tunnel.status();
    const tunnelCredential = await this.tunnelCredential();

    return {
      version: this.version(),
      observedAt,
      identity: stored
        ? {
            deviceId: stored.credential.deviceId,
            organizationId: stored.credential.organizationId,
            revoked: false,
            expiresAt: stored.credential.expiresAt,
            generation: stored.credential.generation,
          }
        : revoked
          ? { deviceId: revoked.deviceId, organizationId: revoked.organizationId, revoked: true, generation: 0 }
          : undefined,
      cloud: {
        configured: Boolean(this.config.cloudBaseUrl),
        reachable: cloudPing.reachable,
        detail: cloudPing.detail,
      },
      gateway: { ...(await this.probeGateway()), port: this.config.gateway.port },
      proton: await this.discoverProton(),
      tunnel: {
        managed: this.config.tunnel.managed,
        installed: tunnelStatus.installed,
        credentialPresent: Boolean(tunnelCredential),
        running: tunnelStatus.running,
        ready: tunnelStatus.ready,
        hostname: tunnelStatus.hostname ?? this.config.tunnel.hostname,
        detail: tunnelStatus.detail,
      },
      secrets: {
        backend: this.secrets.backend,
        secure: this.secrets.secure,
        permissionsOk: secretsAudit.permissionsOk,
        detail: secretsAudit.detail,
      },
      accounts: this.accounts.summary(),
    };
  }

  async health(): Promise<BridgeHealth> {
    return buildHealth(await this.observe());
  }

  async diagnostics(): Promise<BridgeDiagnosticReport> {
    return buildDiagnosticReport(await this.observe());
  }

  // --- heartbeat -----------------------------------------------------------

  /** One heartbeat cycle. Returns the health that was reported. */
  async heartbeatOnce(): Promise<{ health: BridgeHealth; state: "ok" | "revoked" | "unknown_device" | "unregistered" }> {
    const health = await this.health();
    let stored = await this.identity.load();
    if (!stored) return { health, state: "unregistered" };

    stored = await this.identity.renewIfNeeded(stored);

    const components = new Map(health.components.map((entry) => [entry.component, entry.status]));
    const heartbeat: RelayHeartbeat = {
      deviceId: stored.credential.deviceId,
      observedAt: health.observedAt,
      status: health.status,
      gatewayReachable: components.get("gateway") === "ok",
      protonBridgeReachable: components.get("protonBridge") === "ok",
      tunnelConnected: components.get("tunnel") === "ok",
      connectedAccountCount: health.accounts.connected,
    };

    const response = await this.identity.heartbeat(stored, heartbeat, health);
    if (response.state === "revoked" || response.state === "unknown_device") {
      this.log("error", "Mailwarden Cloud revoked this device; stopping the relay");
      await this.stopGateway();
      await this.tunnel.stop();
    }
    return { health, state: response.state };
  }

  // --- repair --------------------------------------------------------------

  /**
   * Safe repairs only. Nothing here resets a Proton account, deletes mail, or
   * discards a credential a human would have to re-authorize.
   */
  async repair(action: BridgeRepairAction): Promise<BridgeRepairResult> {
    switch (action) {
      case "restart_gateway": {
        await this.stopGateway();
        const gateway = await this.startGateway();
        return { action, applied: true, detail: `Gateway restarted on port ${gateway.port}` };
      }
      case "restart_tunnel": {
        const credential = await this.tunnelCredential();
        if (!credential) {
          return { action, applied: false, detail: "No scoped tunnel credential is stored for this device" };
        }
        const status = await this.tunnel.restart(credential);
        return { action, applied: status.running, detail: status.detail };
      }
      case "refresh_registration": {
        const stored = await this.identity.load();
        if (!stored) return { action, applied: false, detail: "This device is not registered yet" };
        const refreshed = await this.identity.renewIfNeeded(stored, Date.now());
        const tunnelCredential = await this.cloud.fetchTunnelCredential(refreshed.credential).catch(() => null);
        if (tunnelCredential) await this.storeTunnelCredential(tunnelCredential);
        return {
          action,
          applied: true,
          detail: `Registration refreshed at generation ${refreshed.credential.generation}`,
        };
      }
      case "recheck_proton": {
        const discovery = await this.discoverProton();
        return { action, applied: discovery.state === "running", detail: discovery.detail };
      }
      case "fix_permissions": {
        await mkdir(this.paths.stateDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
        await chmod(this.paths.stateDir, 0o700).catch(() => undefined);
        const repaired = await this.secrets.repairPermissions();
        return {
          action,
          applied: repaired,
          detail: repaired ? "Credential file permissions reset to 0600" : "Could not change credential permissions",
        };
      }
      default: {
        const exhaustive: never = action;
        return { action: exhaustive, applied: false, detail: "Unknown repair action" };
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.stopGateway();
    await this.tunnel.stop();
  }
}
