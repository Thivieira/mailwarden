/**
 * Versioned local Bridge configuration.
 *
 * Rule: no secret ever belongs in this file. Credentials live in the secret
 * store, so the config can be read by an admin, attached to a support ticket, or
 * printed by `mailwarden-bridge status` without leaking anything.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { BridgePaths } from "./paths";

export const BRIDGE_CONFIG_VERSION = 1;

export const bridgeConfigSchema = z.object({
  configVersion: z.number().int().positive().default(BRIDGE_CONFIG_VERSION),
  deviceName: z.string().min(1).max(120),
  /** Mailwarden Cloud base URL, e.g. https://mailwarden.app */
  cloudBaseUrl: z.string().url().or(z.literal("")).default(""),
  gateway: z
    .object({
      /** Loopback only. The tunnel is what makes the gateway reachable. */
      host: z.literal("127.0.0.1").default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(8080),
      maxRequestBytes: z.number().int().min(1024).default(1024 * 1024),
      requestsPerMinute: z.number().int().min(1).default(600),
    })
    .default({
      host: "127.0.0.1",
      port: 8080,
      maxRequestBytes: 1024 * 1024,
      requestsPerMinute: 600,
    }),
  proton: z
    .object({
      imapHost: z.string().default("127.0.0.1"),
      imapPort: z.number().int().min(1).max(65535).default(1143),
      smtpHost: z.string().default("127.0.0.1"),
      smtpPort: z.number().int().min(1).max(65535).default(1025),
      binaryPath: z.string().optional(),
    })
    .default({
      imapHost: "127.0.0.1",
      imapPort: 1143,
      smtpHost: "127.0.0.1",
      smtpPort: 1025,
    }),
  tunnel: z
    .object({
      /** True once Cloud has issued this device a scoped tunnel credential. */
      managed: z.boolean().default(false),
      hostname: z.string().optional(),
      cloudflaredPath: z.string().optional(),
      metricsAddress: z.string().default("127.0.0.1:20241"),
    })
    .default({
      managed: false,
      metricsAddress: "127.0.0.1:20241",
    }),
  heartbeatSeconds: z.number().int().min(30).max(3600).default(60),
  localApi: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(8765),
    })
    .default({
      enabled: true,
      port: 8765,
    }),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type BridgeConfig = z.infer<typeof bridgeConfigSchema>;

export function defaultBridgeConfig(deviceName: string): BridgeConfig {
  return bridgeConfigSchema.parse({ configVersion: BRIDGE_CONFIG_VERSION, deviceName });
}

/**
 * Parses config that may have been written by an older Bridge. Unknown future
 * versions are refused rather than silently reinterpreted.
 */
export function parseBridgeConfig(raw: unknown): BridgeConfig {
  const version = (raw as { configVersion?: unknown } | null)?.configVersion;
  if (typeof version === "number" && version > BRIDGE_CONFIG_VERSION) {
    throw new Error(
      `Bridge config version ${version} is newer than this Bridge understands (${BRIDGE_CONFIG_VERSION}); upgrade Mailwarden Bridge`
    );
  }
  return bridgeConfigSchema.parse(raw);
}

export async function loadBridgeConfig(paths: BridgePaths, fallbackDeviceName: string): Promise<BridgeConfig> {
  const file = Bun.file(paths.configFile);
  if (!(await file.exists())) return defaultBridgeConfig(fallbackDeviceName);
  return parseBridgeConfig(await file.json());
}

export async function saveBridgeConfig(paths: BridgePaths, config: BridgeConfig): Promise<void> {
  await mkdir(dirname(paths.configFile), { recursive: true, mode: 0o755 });
  await Bun.write(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Environment overrides for the pre-Bridge deployment.
 *
 * The AlmaLinux reference relay is configured entirely through
 * `/etc/mailwarden/bridge.env`, so those variables keep working and simply take
 * precedence over the config file. `PROTON_GATEWAY_API_KEY` stays supported as
 * the legacy shared key; it is deployment-wide and is being replaced by
 * per-device credentials.
 */
export function applyLegacyEnvOverrides(
  config: BridgeConfig,
  env: Record<string, string | undefined> = process.env
): BridgeConfig {
  const port = Number(env.PORT);
  const imapPort = Number(env.PROTON_BRIDGE_IMAP_PORT);
  const smtpPort = Number(env.PROTON_BRIDGE_SMTP_PORT);
  return {
    ...config,
    cloudBaseUrl: env.MAILWARDEN_CLOUD_URL || config.cloudBaseUrl,
    gateway: {
      ...config.gateway,
      port: Number.isFinite(port) && port > 0 ? port : config.gateway.port,
    },
    proton: {
      ...config.proton,
      imapHost: env.PROTON_BRIDGE_HOST || config.proton.imapHost,
      smtpHost: env.PROTON_BRIDGE_HOST || config.proton.smtpHost,
      imapPort: Number.isFinite(imapPort) && imapPort > 0 ? imapPort : config.proton.imapPort,
      smtpPort: Number.isFinite(smtpPort) && smtpPort > 0 ? smtpPort : config.proton.smtpPort,
    },
  };
}
