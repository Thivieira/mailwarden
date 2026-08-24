#!/usr/bin/env bun
/**
 * Mailwarden Bridge daemon.
 *
 * Long-running relay process: it serves the Proton Gateway on loopback, keeps the
 * managed Cloudflare Tunnel up, heartbeats to Mailwarden Cloud, exposes the local
 * API the desktop shell talks to, and stops cleanly when systemd asks it to.
 */
import { BridgeCore } from "./core/bridge";
import { startLocalApi, type RunningLocalApi } from "./core/local-api";

export interface DaemonHandle {
  core: BridgeCore;
  localApi: RunningLocalApi | null;
  stop(): Promise<void>;
}

export async function startDaemon(core?: BridgeCore): Promise<DaemonHandle> {
  const bridge = core ?? (await BridgeCore.create());
  const log = bridge.log;

  // A gateway that cannot bind must not take the daemon down with it: the relay
  // stays up so the heartbeat, the local API, and `doctor` can explain the
  // problem — a port conflict is diagnosable, a dead process is not.
  try {
    await bridge.startGateway();
  } catch (error) {
    log("error", "Could not start the Proton gateway; the relay is running degraded", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  try {
    await bridge.startTunnel();
  } catch (error) {
    log("error", "Could not start the managed tunnel", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  const localApi = bridge.config.localApi.enabled ? await startLocalApi(bridge) : null;
  if (localApi) {
    log("info", "Local API listening for the desktop shell", {
      port: localApi.port,
      authFile: bridge.paths.localApiTokenFile,
    });
  }

  const identity = await bridge.identity.load();
  if (!identity) {
    log("warn", "This device has no Mailwarden identity yet; run `mailwarden-bridge setup`");
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (seconds: number) => {
    if (stopped) return;
    timer = setTimeout(cycle, Math.max(30, seconds) * 1000);
  };

  const cycle = async () => {
    let nextSeconds = bridge.config.heartbeatSeconds;
    try {
      const result = await bridge.heartbeatOnce();
      if (result.state === "revoked" || result.state === "unknown_device") {
        log("error", "Device registration is no longer valid; the relay has stopped serving requests");
        // Keep the process alive so `status`/`doctor` can still explain why.
        nextSeconds = 300;
      } else if (result.state === "unregistered") {
        nextSeconds = 300;
      } else {
        log("debug", "Heartbeat accepted", { status: result.health.status });
      }
    } catch (error) {
      // Transient Cloud failures are expected; the relay keeps serving Proton.
      log("warn", "Heartbeat failed", { message: error instanceof Error ? error.message : "unknown error" });
    }
    schedule(nextSeconds);
  };

  // Report immediately: the floor exists to pace the loop, not to delay the first
  // beat. Waiting for it made a freshly started relay look offline for 30 seconds.
  void cycle();

  const handle: DaemonHandle = {
    core: bridge,
    localApi,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      await localApi?.stop();
      await bridge.shutdown();
      log("info", "Mailwarden Bridge stopped");
    },
  };

  return handle;
}

if (import.meta.main) {
  const handle = await startDaemon();
  const shutdown = () => {
    void handle.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
