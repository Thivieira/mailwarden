/**
 * Where Bridge keeps its config, state, and secrets.
 *
 * Two layouts, chosen by whether the process can write the system directories:
 * a system service uses /etc/mailwarden + /var/lib/mailwarden, and a developer or
 * desktop run uses the XDG directories. Secrets never live in the config file, so
 * config can be world-readable while the secret store stays 0600.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export interface BridgePaths {
  configDir: string;
  configFile: string;
  stateDir: string;
  secretsFile: string;
  runtimeDir: string;
  localApiTokenFile: string;
}

const SYSTEM_CONFIG_DIR = "/etc/mailwarden";
const SYSTEM_STATE_DIR = "/var/lib/mailwarden";

export function resolveBridgePaths(env: Record<string, string | undefined> = process.env): BridgePaths {
  const home = env.HOME || homedir();
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  const configDir =
    env.MAILWARDEN_BRIDGE_CONFIG_DIR ||
    (isRoot ? SYSTEM_CONFIG_DIR : join(env.XDG_CONFIG_HOME || join(home, ".config"), "mailwarden-bridge"));

  const stateDir =
    env.MAILWARDEN_BRIDGE_STATE_DIR ||
    (isRoot ? SYSTEM_STATE_DIR : join(env.XDG_STATE_HOME || join(home, ".local", "state"), "mailwarden-bridge"));

  const runtimeDir = env.MAILWARDEN_BRIDGE_RUNTIME_DIR || stateDir;

  return {
    configDir,
    configFile: join(configDir, "bridge.json"),
    stateDir,
    secretsFile: join(stateDir, "secrets.json"),
    runtimeDir,
    localApiTokenFile: join(runtimeDir, "local-api.token"),
  };
}
