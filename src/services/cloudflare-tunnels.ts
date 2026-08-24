/**
 * Managed Cloudflare Tunnel allocation.
 *
 * Mailwarden provisions a dedicated tunnel per relay device using its own
 * Cloudflare account token, and hands the device only that tunnel's run token.
 * The account token never leaves Cloud, is never logged, and is never returned
 * in any response. A customer host can therefore connect outbound with no
 * inbound port, no static IP, and no certificate of its own — and can be cut off
 * by deleting one tunnel.
 *
 * API surface used (verified against Cloudflare's documentation):
 *   POST   /accounts/{account}/cfd_tunnel                       create
 *   PUT    /accounts/{account}/cfd_tunnel/{id}/configurations    ingress
 *   GET    /accounts/{account}/cfd_tunnel/{id}/token             run token
 *   DELETE /accounts/{account}/cfd_tunnel/{id}                   delete
 *   POST   /zones/{zone}/dns_records                             CNAME
 *   GET    /zones/{zone}/dns_records?name=                       lookup
 *   DELETE /zones/{zone}/dns_records/{recordId}                  delete
 *
 * The API token needs `Cloudflare Tunnel Write` on the account and `DNS Write`
 * on the zone.
 */
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";
import { config } from "../config";
import { logger } from "../utils/logger";
import { ConfigurationError, ValidationError } from "../utils/errors";

const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 15_000;

export interface ManagedTunnel {
  tunnelId: string;
  hostname: string;
}

/** The subset of Cloudflare's API Mailwarden depends on, so tests can fake it. */
export interface CloudflareTunnelApi {
  createTunnel(name: string): Promise<{ id: string }>;
  configureIngress(tunnelId: string, hostname: string, service: string): Promise<void>;
  getRunToken(tunnelId: string): Promise<string>;
  deleteTunnel(tunnelId: string): Promise<void>;
  upsertDnsRecord(hostname: string, tunnelId: string): Promise<void>;
  deleteDnsRecord(hostname: string): Promise<void>;
}

export interface CloudflareCredentials {
  apiToken: string;
  accountId: string;
  zoneId: string;
  hostnameSuffix: string;
}

/** Reads managed-tunnel settings, or null when the feature is not configured. */
export function tunnelCredentials(): CloudflareCredentials | null {
  const apiToken = config.CLOUDFLARE_TUNNEL_API_TOKEN;
  const accountId = config.CLOUDFLARE_TUNNEL_ACCOUNT_ID;
  const zoneId = config.CLOUDFLARE_TUNNEL_ZONE_ID;
  const hostnameSuffix = config.RELAY_HOSTNAME_SUFFIX;
  if (!apiToken || !accountId || !zoneId || !hostnameSuffix) return null;
  return { apiToken, accountId, zoneId, hostnameSuffix };
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

export class HttpCloudflareTunnelApi implements CloudflareTunnelApi {
  constructor(private readonly credentials: CloudflareCredentials) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.credentials.apiToken}`,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Never include the request: it carries the account token.
      throw new ConfigurationError("Cloudflare API is unreachable");
    }

    const body = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
    if (!response.ok || !body?.success) {
      // Cloudflare's own error text is safe; the token is not echoed back.
      const detail = body?.errors?.map((error) => `${error.code}: ${error.message}`).join("; ");
      throw new ConfigurationError(`Cloudflare API rejected the request (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return body.result;
  }

  async createTunnel(name: string): Promise<{ id: string }> {
    // `config_src: cloudflare` makes the tunnel remotely managed, so ingress is
    // set through the API and the device only ever runs `cloudflared … --token`.
    return this.request<{ id: string }>(`/accounts/${this.credentials.accountId}/cfd_tunnel`, {
      method: "POST",
      body: JSON.stringify({ name, config_src: "cloudflare" }),
    });
  }

  async configureIngress(tunnelId: string, hostname: string, service: string): Promise<void> {
    await this.request(`/accounts/${this.credentials.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      method: "PUT",
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service },
            // Everything else is refused at the edge of the customer's host.
            { service: "http_status:404" },
          ],
        },
      }),
    });
  }

  async getRunToken(tunnelId: string): Promise<string> {
    return this.request<string>(`/accounts/${this.credentials.accountId}/cfd_tunnel/${tunnelId}/token`);
  }

  async deleteTunnel(tunnelId: string): Promise<void> {
    await this.request(`/accounts/${this.credentials.accountId}/cfd_tunnel/${tunnelId}`, { method: "DELETE" });
  }

  async upsertDnsRecord(hostname: string, tunnelId: string): Promise<void> {
    const existing = await this.request<Array<{ id: string }>>(
      `/zones/${this.credentials.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`
    );
    const content = `${tunnelId}.cfargotunnel.com`;
    if (existing.length > 0) {
      await this.request(`/zones/${this.credentials.zoneId}/dns_records/${existing[0]!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ type: "CNAME", name: hostname, content, proxied: true, ttl: 1 }),
      });
      return;
    }
    await this.request(`/zones/${this.credentials.zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name: hostname, content, proxied: true, ttl: 1 }),
    });
  }

  async deleteDnsRecord(hostname: string): Promise<void> {
    const existing = await this.request<Array<{ id: string }>>(
      `/zones/${this.credentials.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`
    );
    for (const record of existing) {
      await this.request(`/zones/${this.credentials.zoneId}/dns_records/${record.id}`, { method: "DELETE" });
    }
  }
}

/**
 * Derives the relay hostname for a device.
 *
 * Device ids are nanoids, which include `_` and `-`; `_` is not valid in a
 * hostname label, so the id is normalized and prefixed. Uniqueness is enforced
 * by a unique index on the column, not by hoping normalization never collides.
 */
export function relayHostname(deviceId: string, suffix: string): string {
  const label = `mw-${deviceId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
  return `${label}.${suffix.replace(/^\.+/, "")}`;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Validates the local service a device asks the tunnel to expose.
 *
 * Loopback only, and by deliberate design: a Mailwarden-managed tunnel that
 * could point at an arbitrary address would become a pivot into the customer's
 * private network, published on a Mailwarden hostname.
 */
export function validateLocalService(value: string | undefined): string {
  const candidate = (value || "").trim() || "http://127.0.0.1:8080";
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ValidationError("Local gateway service must be a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Local gateway service must be HTTP");
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new ValidationError("A managed tunnel may only expose a loopback service on the relay host");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ValidationError("Local gateway service must not include a path");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${url.hostname}:${port}`;
}

export interface ProvisionInput {
  deviceId: string;
  organizationId: string;
  localService: string;
  /** Already-allocated tunnel, when the device is asking again. */
  existing?: { tunnelId: string; hostname: string } | null;
}

export class CloudflareTunnelService {
  constructor(private readonly apiFactory: (credentials: CloudflareCredentials) => CloudflareTunnelApi = (c) => new HttpCloudflareTunnelApi(c)) {}

  isConfigured(): boolean {
    return tunnelCredentials() !== null;
  }

  /**
   * Allocates (or re-reads) the tunnel for a device and returns its run token.
   * Returns null when managed tunnels are not configured, which is what keeps
   * the endpoint honest on a deployment that has no Cloudflare credentials.
   */
  async provision(input: ProvisionInput): Promise<{ tunnelId: string; hostname: string; token: string } | null> {
    const credentials = tunnelCredentials();
    if (!credentials) return null;
    const api = this.apiFactory(credentials);

    if (input.existing?.tunnelId && input.existing.hostname) {
      // Re-configure ingress on every fetch: the device's gateway port can change.
      await api.configureIngress(input.existing.tunnelId, input.existing.hostname, input.localService);
      return {
        tunnelId: input.existing.tunnelId,
        hostname: input.existing.hostname,
        token: await api.getRunToken(input.existing.tunnelId),
      };
    }

    const hostname = relayHostname(input.deviceId, credentials.hostnameSuffix);
    const created = await api.createTunnel(`mailwarden-relay-${input.deviceId}`);
    logger.info("Provisioned managed relay tunnel", {
      deviceId: input.deviceId,
      organizationId: input.organizationId,
      tunnelId: created.id,
      hostname,
    });

    try {
      await api.configureIngress(created.id, hostname, input.localService);
      await api.upsertDnsRecord(hostname, created.id);
    } catch (error) {
      // Do not leave an orphan tunnel behind a failed setup.
      await api.deleteTunnel(created.id).catch(() => undefined);
      throw error;
    }

    return { tunnelId: created.id, hostname, token: await api.getRunToken(created.id) };
  }

  /**
   * Removes a device's tunnel and hostname.
   *
   * Best effort by design: revocation is authoritative locally and must not wait
   * on Cloudflare. What Cloudflare would not delete is recorded in the cleanup
   * ledger so the reconciliation pass can finish the job.
   */
  async release(
    tunnelId: string,
    hostname: string | null,
    owner?: { tenantId: string; deviceId: string }
  ): Promise<boolean> {
    const credentials = tunnelCredentials();
    if (!credentials) {
      // Nothing to call. Still record it: credentials may be restored later.
      if (owner) await this.recordPending(tunnelId, hostname, owner, "managed tunnels are not configured");
      return false;
    }

    const api = this.apiFactory(credentials);
    try {
      if (hostname) await api.deleteDnsRecord(hostname);
      await api.deleteTunnel(tunnelId);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      logger.warn("Could not release the managed relay tunnel; queued for reconciliation", { tunnelId, message });
      if (owner) await this.recordPending(tunnelId, hostname, owner, message);
      return false;
    }
  }

  private async recordPending(
    tunnelId: string,
    hostname: string | null,
    owner: { tenantId: string; deviceId: string },
    error: string
  ): Promise<void> {
    const now = new Date();
    await db
      .insert(schema.relayTunnelCleanup)
      .values({
        id: nanoid(),
        tenantId: owner.tenantId,
        deviceId: owner.deviceId,
        tunnelId,
        hostname,
        attempts: 1,
        lastAttemptAt: now,
        lastError: error.slice(0, 500),
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: schema.relayTunnelCleanup.tunnelId,
        set: { attempts: sql`attempts + 1`, lastAttemptAt: now, lastError: error.slice(0, 500) },
      });
  }

  /**
   * Retries queued releases. Runs from the scheduled worker, so an outage during
   * revocation resolves itself once Cloudflare is reachable again.
   */
  async reconcile(limit = 20, now = new Date()): Promise<{ attempted: number; released: number }> {
    if (!this.isConfigured()) return { attempted: 0, released: 0 };

    // Back off: retry a given tunnel at most once every fifteen minutes.
    const retryBefore = new Date(now.getTime() - 15 * 60_000);
    const pending = await db
      .select()
      .from(schema.relayTunnelCleanup)
      .where(
        and(
          isNull(schema.relayTunnelCleanup.releasedAt),
          or(
            isNull(schema.relayTunnelCleanup.lastAttemptAt),
            lt(schema.relayTunnelCleanup.lastAttemptAt, retryBefore)
          )
        )
      )
      .orderBy(asc(schema.relayTunnelCleanup.createdAt))
      .limit(limit);

    let released = 0;
    for (const row of pending) {
      const credentials = tunnelCredentials()!;
      const api = this.apiFactory(credentials);
      try {
        if (row.hostname) await api.deleteDnsRecord(row.hostname);
        await api.deleteTunnel(row.tunnelId);
        await db
          .update(schema.relayTunnelCleanup)
          .set({ releasedAt: now, lastAttemptAt: now, attempts: row.attempts + 1, lastError: null })
          .where(eq(schema.relayTunnelCleanup.id, row.id));
        released += 1;
        logger.info("Released an orphaned relay tunnel", { tunnelId: row.tunnelId });
      } catch (error) {
        await db
          .update(schema.relayTunnelCleanup)
          .set({
            lastAttemptAt: now,
            attempts: row.attempts + 1,
            lastError: (error instanceof Error ? error.message : "unknown error").slice(0, 500),
          })
          .where(eq(schema.relayTunnelCleanup.id, row.id));
      }
    }
    return { attempted: pending.length, released };
  }

  /** Outstanding orphans, for operations and for the health surface. */
  async pendingCleanupCount(): Promise<number> {
    const rows = await db
      .select({ id: schema.relayTunnelCleanup.id })
      .from(schema.relayTunnelCleanup)
      .where(isNull(schema.relayTunnelCleanup.releasedAt));
    return rows.length;
  }
}

export const cloudflareTunnelService = new CloudflareTunnelService();
