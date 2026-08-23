/**
 * Cloudflare Tunnel lifecycle.
 *
 * The tunnel is product infrastructure, not deployment glue: it is what lets a
 * customer's relay reach Mailwarden Cloud with no inbound port, no static IP and
 * no certificate of their own. Mailwarden Cloud provisions the tunnel with its
 * own Cloudflare account token; a device only ever receives the scoped
 * `RelayTunnelCredential` for its own tunnel.
 *
 * The token is passed to cloudflared through the `TUNNEL_TOKEN` environment
 * variable rather than `--token` on the command line, because argv is readable
 * by every user on the host through `ps`.
 */
import type { RelayTunnelCredential } from "@mailwarden/contracts";
import type { BridgeLogger } from "./log";
import { noopLogger } from "./log";
import type { SystemAdapters } from "./system";

export interface TunnelProcess {
  readonly pid: number;
  kill(): void;
  readonly exited: Promise<number>;
}

export interface TunnelStatus {
  installed: boolean;
  version?: string;
  binaryPath?: string;
  /** A cloudflared systemd unit outside Mailwarden's control is running. */
  externallyManaged: boolean;
  running: boolean;
  ready: boolean;
  readyConnections: number;
  hostname?: string;
  detail: string;
}

export interface TunnelManagerOptions {
  adapters: SystemAdapters;
  metricsAddress?: string;
  cloudflaredPath?: string;
  logger?: BridgeLogger;
  /** Test seam: spawn the cloudflared child process. */
  spawn?: (command: string[], env: Record<string, string>) => TunnelProcess;
  /** Test seam: read cloudflared's local /ready endpoint. */
  readReady?: (metricsAddress: string) => Promise<{ ready: boolean; connections: number }>;
}

function defaultSpawn(command: string[], env: Record<string, string>): TunnelProcess {
  const [executable, ...args] = command;
  const proc = Bun.spawn([executable!, ...args], {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  return { pid: proc.pid, kill: () => proc.kill(), exited: proc.exited };
}

async function defaultReadReady(metricsAddress: string): Promise<{ ready: boolean; connections: number }> {
  try {
    const response = await fetch(`http://${metricsAddress}/ready`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { ready: false, connections: 0 };
    const body = (await response.json()) as { readyConnections?: number };
    const connections = Number(body.readyConnections ?? 0);
    return { ready: connections > 0, connections };
  } catch {
    return { ready: false, connections: 0 };
  }
}

export class TunnelManager {
  private child: TunnelProcess | null = null;
  private hostname?: string;
  private readonly log: BridgeLogger;
  private readonly metricsAddress: string;

  constructor(private readonly options: TunnelManagerOptions) {
    this.log = options.logger ?? noopLogger;
    this.metricsAddress = options.metricsAddress ?? "127.0.0.1:20241";
  }

  async discover(): Promise<{ installed: boolean; binaryPath?: string; version?: string }> {
    const binaryPath =
      (this.options.cloudflaredPath && (await this.options.adapters.fileExists(this.options.cloudflaredPath))
        ? this.options.cloudflaredPath
        : null) ?? (await this.options.adapters.which("cloudflared"));
    if (!binaryPath) return { installed: false };
    const result = await this.options.adapters.run([binaryPath, "--version"], 10_000);
    const version = /(\d+\.\d+\.\d+)/.exec(`${result.stdout}${result.stderr}`)?.[1];
    return { installed: true, binaryPath, version };
  }

  /** True when a cloudflared service outside Bridge is already running this host's tunnel. */
  async isExternallyManaged(): Promise<boolean> {
    const result = await this.options.adapters.run(["systemctl", "is-active", "cloudflared"], 5_000);
    return result.stdout.trim() === "active";
  }

  async status(): Promise<TunnelStatus> {
    const discovery = await this.discover();
    if (!discovery.installed) {
      return {
        installed: false,
        externallyManaged: false,
        running: false,
        ready: false,
        readyConnections: 0,
        detail: "cloudflared is not installed on this host",
      };
    }

    const externallyManaged = this.child === null && (await this.isExternallyManaged());
    const readReady = this.options.readReady ?? defaultReadReady;
    const ready = await readReady(this.metricsAddress);
    const running = this.child !== null || externallyManaged || ready.ready;

    return {
      installed: true,
      version: discovery.version,
      binaryPath: discovery.binaryPath,
      externallyManaged,
      running,
      ready: ready.ready,
      readyConnections: ready.connections,
      hostname: this.hostname,
      detail: ready.ready
        ? `Tunnel connected with ${ready.connections} edge connection(s)`
        : running
          ? "cloudflared is running but has no ready edge connection"
          : "cloudflared is installed but not running",
    };
  }

  /**
   * Starts the tunnel for this device. Refuses when another cloudflared service
   * already owns the tunnel, so Bridge never races the admin's own unit.
   */
  async start(credential: RelayTunnelCredential): Promise<TunnelStatus> {
    if (this.child) return this.status();

    const discovery = await this.discover();
    if (!discovery.installed || !discovery.binaryPath) {
      throw new Error("cloudflared is not installed; install it before starting the managed tunnel");
    }
    if (await this.isExternallyManaged()) {
      this.hostname = credential.hostname;
      this.log("info", "A cloudflared service is already running; leaving tunnel management to it");
      return this.status();
    }

    const spawn = this.options.spawn ?? defaultSpawn;
    this.hostname = credential.hostname;
    this.child = spawn(
      [discovery.binaryPath, "tunnel", "--no-autoupdate", "--metrics", this.metricsAddress, "run"],
      { TUNNEL_TOKEN: credential.token }
    );
    this.log("info", "Started managed Cloudflare Tunnel", { hostname: credential.hostname, pid: this.child.pid });

    this.child.exited.then((code) => {
      this.log(code === 0 ? "info" : "warn", "cloudflared exited", { code });
      this.child = null;
    });

    return this.status();
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.child.kill();
    await this.child.exited.catch(() => 0);
    this.child = null;
  }

  async restart(credential: RelayTunnelCredential): Promise<TunnelStatus> {
    await this.stop();
    return this.start(credential);
  }
}
