/**
 * Device credential storage.
 *
 * Desktop targets should end up on the native keyring; the one implementation
 * verified today is the freedesktop Secret Service via `secret-tool`, with a
 * 0600 file store as the headless fallback. The fallback is a real tradeoff and
 * is reported as such by `doctor` rather than hidden: on a headless server with
 * no keyring, file permissions and disk encryption are the protection.
 */
import { chmod, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgePaths } from "./paths";
import type { SystemAdapters } from "./system";

export type BridgeSecretKey =
  | "device.credential"
  | "tunnel.credential"
  | "localApi.token"
  | "gateway.legacyKey";

export interface SecretStoreAudit {
  permissionsOk: boolean;
  detail: string;
}

export interface SecretStore {
  readonly backend: string;
  /** True when an OS keyring holds the secret rather than a permissioned file. */
  readonly secure: boolean;
  get(key: BridgeSecretKey): Promise<string | null>;
  set(key: BridgeSecretKey, value: string): Promise<void>;
  delete(key: BridgeSecretKey): Promise<void>;
  audit(): Promise<SecretStoreAudit>;
  repairPermissions(): Promise<boolean>;
}

const SERVICE = "mailwarden-bridge";

/** freedesktop Secret Service, used when a session keyring is actually reachable. */
export class SecretServiceStore implements SecretStore {
  readonly backend = "secret-service";
  readonly secure = true;

  constructor(private readonly adapters: SystemAdapters) {}

  async get(key: BridgeSecretKey): Promise<string | null> {
    const result = await this.adapters.run(["secret-tool", "lookup", "service", SERVICE, "key", key]);
    if (result.code !== 0) return null;
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  }

  async set(key: BridgeSecretKey, value: string): Promise<void> {
    // secret-tool reads the value from stdin, keeping it out of argv and history.
    const proc = Bun.spawn(["secret-tool", "store", "--label", `Mailwarden Bridge ${key}`, "service", SERVICE, "key", key], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(value);
    await proc.stdin.end();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`Failed to store ${key} in the system keyring`);
  }

  async delete(key: BridgeSecretKey): Promise<void> {
    await this.adapters.run(["secret-tool", "clear", "service", SERVICE, "key", key]);
  }

  async audit(): Promise<SecretStoreAudit> {
    return { permissionsOk: true, detail: "Credentials are held in the system keyring (Secret Service)" };
  }

  async repairPermissions(): Promise<boolean> {
    return true;
  }
}

/** 0600 JSON file under the Bridge state directory. */
export class FileSecretStore implements SecretStore {
  readonly backend = "file";
  readonly secure = false;

  constructor(private readonly path: string) {}

  private async readAll(): Promise<Record<string, string>> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return {};
    try {
      return (await file.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeAll(values: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700).catch(() => undefined);
    await Bun.write(this.path, `${JSON.stringify(values, null, 2)}\n`);
    await chmod(this.path, 0o600);
  }

  async get(key: BridgeSecretKey): Promise<string | null> {
    return (await this.readAll())[key] ?? null;
  }

  async set(key: BridgeSecretKey, value: string): Promise<void> {
    const values = await this.readAll();
    values[key] = value;
    await this.writeAll(values);
  }

  async delete(key: BridgeSecretKey): Promise<void> {
    const values = await this.readAll();
    delete values[key];
    await this.writeAll(values);
  }

  async audit(): Promise<SecretStoreAudit> {
    try {
      const info = await stat(this.path);
      const mode = info.mode & 0o777;
      if (mode & 0o077) {
        return { permissionsOk: false, detail: `Secret file mode is ${mode.toString(8)}; expected 600` };
      }
      return {
        permissionsOk: true,
        detail: "Credentials are in a 0600 file; no OS keyring is available to this user",
      };
    } catch {
      return { permissionsOk: true, detail: "No credentials stored yet" };
    }
  }

  async repairPermissions(): Promise<boolean> {
    try {
      await chmod(dirname(this.path), 0o700);
      await chmod(this.path, 0o600);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Picks the strongest store that actually works here. `secret-tool` being on
 * PATH is not enough — a headless service user usually has no unlocked keyring,
 * and a store that fails at write time is worse than an honest file fallback.
 */
export async function createSecretStore(paths: BridgePaths, adapters: SystemAdapters): Promise<SecretStore> {
  if (await adapters.which("secret-tool")) {
    const probe = await adapters.run(["secret-tool", "lookup", "service", SERVICE, "key", "probe"], 5_000);
    // Exit 1 means "no such secret" (a working keyring); other failures mean no usable daemon.
    if (probe.code === 0 || probe.code === 1) return new SecretServiceStore(adapters);
  }
  return new FileSecretStore(paths.secretsFile);
}
