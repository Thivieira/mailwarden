import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { config } from "../config";
import { db, schema } from "../db";
import { AuthenticationError, ConfigurationError } from "../utils/errors";
import { auditService } from "./audit";
import { authService } from "./auth";

const DEFAULT_ITERATIONS = 120_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) throw new AuthenticationError("Stored credential is invalid");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deriveSecretHash(secret: string, saltHex: string, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBytes = hexToBytes(saltHex);
  const saltBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength
  ) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    material,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function rawFirst<T = any>(query: string, params: unknown[] = []): Promise<T | null> {
  const client = db.$client;
  const statement = client.prepare(query);

  if (typeof statement.bind === "function") {
    const bound = statement.bind(...params);
    if (typeof bound.first === "function") return (await bound.first()) as T | null;
    if (typeof bound.get === "function") return (await bound.get()) as T | null;
  }

  if (typeof statement.get === "function") return (await statement.get(...params)) as T | null;
  throw new Error("Database client does not support prepared single-row queries");
}

async function rawRun(query: string, params: unknown[] = []): Promise<void> {
  const client = db.$client;
  const statement = client.prepare(query);

  if (typeof statement.bind === "function") {
    const bound = statement.bind(...params);
    if (typeof bound.run === "function") {
      await bound.run();
      return;
    }
  }

  if (typeof statement.run === "function") {
    await statement.run(...params);
    return;
  }
  throw new Error("Database client does not support prepared mutation queries");
}

type CredentialRow = {
  tenant_id: string;
  user_id: string;
  secret_hash: string;
  salt: string;
  iterations: number;
};

export class UserAuthService {
  private async getUsersByEmail(email: string) {
    return db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(2);
  }

  async setLoginSecret(tenantId: string, userId: string, secret: string): Promise<void> {
    if (secret.length < 16) throw new AuthenticationError("Mailwarden login secret must contain at least 16 characters");

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = bytesToHex(salt);
    const secretHash = await deriveSecretHash(secret, saltHex, DEFAULT_ITERATIONS);
    const now = Date.now();

    await rawRun(
      `INSERT INTO user_auth_credentials
        (id, tenant_id, user_id, secret_hash, salt, iterations, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         secret_hash = excluded.secret_hash,
         salt = excluded.salt,
         iterations = excluded.iterations,
         updated_at = excluded.updated_at`,
      [nanoid(), tenantId, userId, secretHash, saltHex, DEFAULT_ITERATIONS, now, now]
    );
  }

  private async getCredential(userId: string): Promise<CredentialRow | null> {
    return rawFirst<CredentialRow>(
      `SELECT tenant_id, user_id, secret_hash, salt, iterations
       FROM user_auth_credentials
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
  }

  async authenticateUser(email: string, loginSecret: string, displayName?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    let users = await this.getUsersByEmail(normalizedEmail);

    // Bootstrap only the deployment owner. Arbitrary unknown emails are never auto-created.
    if (users.length === 0 && config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET) {
      const ownerMatches =
        normalizedEmail === config.OWNER_EMAIL.toLowerCase() &&
        constantTimeEqual(loginSecret, config.OWNER_LOGIN_SECRET);
      if (ownerMatches) {
        const created = await authService.createTenantAndOwner({
          tenantName: "Personal Mailwarden",
          slug: `personal-${nanoid(8)}`,
          ownerEmail: normalizedEmail,
          ownerDisplayName: displayName || normalizedEmail.split("@")[0] || "Owner",
          issueInitialToken: false,
        });
        await this.setLoginSecret(created.tenantId, created.userId, loginSecret);
        users = await this.getUsersByEmail(normalizedEmail);
      }
    }

    if (users.length !== 1) {
      throw new AuthenticationError(users.length === 0 ? "Unknown Mailwarden user" : "Ambiguous Mailwarden login identity");
    }

    const user = users[0];
    let credential = await this.getCredential(user.id);

    // Seamlessly migrate the original owner from env bootstrap auth to a per-user hashed credential.
    if (!credential && config.OWNER_EMAIL && config.OWNER_LOGIN_SECRET) {
      const ownerMatches =
        user.email.toLowerCase() === config.OWNER_EMAIL.toLowerCase() &&
        constantTimeEqual(loginSecret, config.OWNER_LOGIN_SECRET);
      if (ownerMatches) {
        await this.setLoginSecret(user.tenantId, user.id, loginSecret);
        credential = await this.getCredential(user.id);
      }
    }

    if (!credential) throw new AuthenticationError("This Mailwarden user has no login credential configured");
    const candidateHash = await deriveSecretHash(loginSecret, credential.salt, credential.iterations);
    if (!constantTimeEqual(candidateHash, credential.secret_hash)) {
      throw new AuthenticationError("Invalid Mailwarden credentials");
    }

    await rawRun("UPDATE user_auth_credentials SET last_used_at = ?, updated_at = ? WHERE user_id = ?", [Date.now(), Date.now(), user.id]);
    return user;
  }

  async provisionPrivateBetaUser(input: { email: string; displayName: string; vaultName?: string }) {
    if (!config.BETA_ADMIN_SECRET) throw new ConfigurationError("BETA_ADMIN_SECRET is not configured");

    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.getUsersByEmail(normalizedEmail);
    if (existing.length > 0) throw new AuthenticationError("A Mailwarden user with this email already exists");

    const created = await authService.createTenantAndOwner({
      tenantName: input.vaultName || `${input.displayName}'s Mailwarden`,
      slug: `personal-${nanoid(10)}`,
      ownerEmail: normalizedEmail,
      ownerDisplayName: input.displayName,
      issueInitialToken: false,
    });

    const loginSecret = `mw_${nanoid(32)}`;
    await this.setLoginSecret(created.tenantId, created.userId, loginSecret);

    await auditService.logEvent({
      tenantId: created.tenantId,
      userId: created.userId,
      action: "USER_PROVISIONED",
      resourceType: "user",
      resourceId: created.userId,
      details: { privateBeta: true },
    });

    return {
      tenantId: created.tenantId,
      userId: created.userId,
      email: normalizedEmail,
      displayName: input.displayName,
      loginSecret,
    };
  }

  async rotatePrivateBetaSecret(email: string) {
    const users = await this.getUsersByEmail(email.trim().toLowerCase());
    if (users.length !== 1) throw new AuthenticationError("Mailwarden user not found or ambiguous");
    const user = users[0];
    const loginSecret = `mw_${nanoid(32)}`;
    await this.setLoginSecret(user.tenantId, user.id, loginSecret);
    return { email: user.email, loginSecret };
  }

  verifyBetaAdminSecret(secret: string): void {
    if (!config.BETA_ADMIN_SECRET || !constantTimeEqual(secret, config.BETA_ADMIN_SECRET)) {
      throw new AuthenticationError("Invalid private beta administrator secret");
    }
  }
}

export const userAuthService = new UserAuthService();
