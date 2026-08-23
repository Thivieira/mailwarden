/**
 * Gateway request authentication.
 *
 * Three modes, in descending order of preference:
 *
 *   device-signature  HMAC over method/path/timestamp/body with the per-device
 *                     gateway secret. The secret never travels, so a leaked log
 *                     or proxy trace cannot be replayed, and each request is
 *                     bound to a time window and a nonce.
 *   device-token      Bearer equal to the per-device gateway secret. Simple, and
 *                     still independently revocable and rotatable per device.
 *   legacy-shared-key Bearer equal to the deployment-wide PROTON_GATEWAY_API_KEY.
 *                     Compatibility only, for relays that predate device identity.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const GATEWAY_PROTOCOL_VERSION = 1;
export const SIGNATURE_WINDOW_SECONDS = 300;

export type GatewayAuthMode = "device-signature" | "device-token" | "legacy-shared-key";

export type GatewayAuthResult =
  | { ok: true; mode: GatewayAuthMode }
  | { ok: false; reason: string };

export interface GatewayAuthSecrets {
  /** Per-device gateway secret issued by Cloud at registration. */
  deviceSecret?: string | null;
  /** Deployment-wide key kept only for migration. */
  legacySharedKey?: string | null;
}

export interface GatewayAuthRequest {
  method: string;
  /** Path only, without host or query. */
  path: string;
  headers: { get(name: string): string | null | undefined };
  rawBody: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signGatewayRequest(
  secret: string,
  input: { method: string; path: string; timestamp: number; body: string }
): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const canonical = [
    "v1",
    String(GATEWAY_PROTOCOL_VERSION),
    input.method.toUpperCase(),
    input.path,
    String(input.timestamp),
    bodyHash,
  ].join("\n");
  return `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

/** Bounded replay cache: a signature is accepted at most once inside its window. */
export class NonceCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = SIGNATURE_WINDOW_SECONDS * 2 * 1000) {}

  /** Returns false when this value was already used. */
  claim(value: string, now = Date.now()): boolean {
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
    }
    if (this.seen.has(value)) return false;
    this.seen.set(value, now + this.ttlMs);
    return true;
  }
}

export function verifyGatewayRequest(
  request: GatewayAuthRequest,
  secrets: GatewayAuthSecrets,
  nonces: NonceCache,
  now = Date.now()
): GatewayAuthResult {
  const signature = request.headers.get("x-mailwarden-signature");
  if (signature) {
    if (!secrets.deviceSecret) return { ok: false, reason: "no_device_credential" };
    const timestamp = Number(request.headers.get("x-mailwarden-timestamp"));
    if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad_timestamp" };
    const skew = Math.abs(now / 1000 - timestamp);
    if (skew > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "stale_timestamp" };

    const expected = signGatewayRequest(secrets.deviceSecret, {
      method: request.method,
      path: request.path,
      timestamp,
      body: request.rawBody,
    });
    if (!constantTimeEquals(signature, expected)) return { ok: false, reason: "bad_signature" };
    if (!nonces.claim(signature, now)) return { ok: false, reason: "replayed_signature" };
    return { ok: true, mode: "device-signature" };
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!bearer) return { ok: false, reason: "missing_credential" };

  if (secrets.deviceSecret && constantTimeEquals(bearer, secrets.deviceSecret)) {
    return { ok: true, mode: "device-token" };
  }
  if (secrets.legacySharedKey && constantTimeEquals(bearer, secrets.legacySharedKey)) {
    return { ok: true, mode: "legacy-shared-key" };
  }
  return { ok: false, reason: "bad_credential" };
}

/** Fixed-window request counter. One process, one relay: no shared store needed. */
export class RateLimiter {
  private windowStart = 0;
  private count = 0;

  constructor(private readonly limitPerMinute: number) {}

  allow(now = Date.now()): boolean {
    const window = Math.floor(now / 60_000);
    if (window !== this.windowStart) {
      this.windowStart = window;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limitPerMinute;
  }
}

const CONTEXT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface GatewayCallContext {
  tenantId: string;
  userId: string;
  accountId: string;
  username?: string;
  password?: string;
}

/**
 * Caller context is attacker-controlled input until Cloud signs it, so every id
 * is shape-checked before it reaches an IMAP command or a log line.
 */
export function readCallContext(headers: { get(name: string): string | null | undefined }): GatewayCallContext {
  const tenantId = headers.get("x-tenant-id") || "";
  const userId = headers.get("x-user-id") || "";
  const accountId = headers.get("x-account-id") || "";
  for (const [name, value] of [
    ["X-Tenant-Id", tenantId],
    ["X-User-Id", userId],
    ["X-Account-Id", accountId],
  ] as const) {
    if (!value) throw new GatewayRequestError(`Missing ${name}`);
    if (!CONTEXT_ID.test(value)) throw new GatewayRequestError(`Malformed ${name}`);
  }
  const username = headers.get("x-proton-username") || undefined;
  const password = headers.get("x-proton-password") || undefined;
  if (username && username.length > 320) throw new GatewayRequestError("Malformed X-Proton-Username");
  return { tenantId, userId, accountId, username, password };
}

export class GatewayRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayRequestError";
  }
}
