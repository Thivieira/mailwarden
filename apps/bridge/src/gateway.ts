#!/usr/bin/env bun
/**
 * Standalone Proton Gateway entrypoint.
 *
 * Kept for the existing AlmaLinux relay (`bun run proton:gateway`), which is
 * configured through `/etc/mailwarden/bridge.env` and authenticates with the
 * deployment-wide `PROTON_GATEWAY_API_KEY`. New installs should run the full
 * daemon instead, which adds device identity, heartbeat, tunnel, and diagnostics.
 */
import { hostname } from "node:os";
import { applyLegacyEnvOverrides, defaultBridgeConfig, loadBridgeConfig } from "./core/config";
import { startGateway, type RunningGateway } from "./core/gateway";
import { createLogger } from "./core/log";
import { resolveBridgePaths } from "./core/paths";
import { createSecretStore } from "./core/secrets";
import { DeviceIdentityManager } from "./core/identity";
import { createCloudClient } from "./core/cloud";
import { systemAdapters } from "./core/system";

export async function startProtonGateway(): Promise<RunningGateway> {
  const paths = resolveBridgePaths();
  const config = applyLegacyEnvOverrides(
    await loadBridgeConfig(paths, hostname()).catch(() => defaultBridgeConfig(hostname()))
  );
  const log = createLogger(config.logLevel);

  const legacySharedKey = process.env.PROTON_GATEWAY_API_KEY ?? null;
  const secrets = await createSecretStore(paths, systemAdapters);
  const identity = new DeviceIdentityManager(secrets, createCloudClient(config.cloudBaseUrl, `${paths.stateDir}/dev-cloud.json`));
  const registered = await identity.load();

  if (!legacySharedKey && !registered) {
    throw new Error(
      "No gateway credential: register this device with `mailwarden-bridge setup`, or set PROTON_GATEWAY_API_KEY for the legacy deployment"
    );
  }

  const gateway = startGateway({
    host: config.gateway.host,
    port: config.gateway.port,
    proton: {
      imapHost: config.proton.imapHost,
      imapPort: config.proton.imapPort,
      smtpHost: config.proton.smtpHost,
      smtpPort: config.proton.smtpPort,
      username: process.env.PROTON_BRIDGE_USERNAME,
      password: process.env.PROTON_BRIDGE_PASSWORD,
    },
    secrets: async () => ({
      deviceSecret: (await identity.load())?.credential.gatewaySecret ?? null,
      legacySharedKey,
    }),
    maxRequestBytes: config.gateway.maxRequestBytes,
    requestsPerMinute: config.gateway.requestsPerMinute,
    logger: log,
  });

  log("info", `Proton Bridge Gateway running on http://${config.gateway.host}:${gateway.port}`);
  return gateway;
}

if (import.meta.main) {
  await startProtonGateway();
}
