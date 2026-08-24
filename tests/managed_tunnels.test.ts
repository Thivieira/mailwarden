/**
 * Managed Cloudflare Tunnel allocation.
 *
 * The property that matters: a device receives a run token for its own tunnel
 * and nothing else. Mailwarden's Cloudflare account token stays in Cloud, the
 * tunnel only ever publishes a loopback service on the relay host, and revoking
 * a device takes its hostname down with it.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../src/db";
import { updateConfig } from "../src/config";
import { authService } from "../src/services/auth";
import { organizationService } from "../src/services/organizations";
import { relayDeviceService } from "../src/services/relay-devices";
import {
  CloudflareTunnelService,
  relayHostname,
  validateLocalService,
  type CloudflareTunnelApi,
} from "../src/services/cloudflare-tunnels";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";

/** Records every call so the test can assert what Cloudflare was asked to do. */
class FakeCloudflareApi implements CloudflareTunnelApi {
  readonly calls: string[] = [];
  readonly tunnels = new Map<string, { ingress?: { hostname: string; service: string } }>();
  readonly dns = new Map<string, string>();
  failIngress = false;

  async createTunnel(name: string) {
    const id = `tun_${nanoid(8)}`;
    this.calls.push(`create:${name}`);
    this.tunnels.set(id, {});
    return { id };
  }
  async configureIngress(tunnelId: string, hostname: string, service: string) {
    this.calls.push(`ingress:${tunnelId}:${hostname}:${service}`);
    if (this.failIngress) throw new Error("ingress rejected");
    this.tunnels.set(tunnelId, { ingress: { hostname, service } });
  }
  async getRunToken(tunnelId: string) {
    this.calls.push(`token:${tunnelId}`);
    return `eyJ-run-token-${tunnelId}`;
  }
  async deleteTunnel(tunnelId: string) {
    this.calls.push(`delete:${tunnelId}`);
    this.tunnels.delete(tunnelId);
  }
  async upsertDnsRecord(hostname: string, tunnelId: string) {
    this.calls.push(`dns:${hostname}`);
    this.dns.set(hostname, `${tunnelId}.cfargotunnel.com`);
  }
  async deleteDnsRecord(hostname: string) {
    this.calls.push(`dns-delete:${hostname}`);
    this.dns.delete(hostname);
  }
}

let api: FakeCloudflareApi;

const CLOUD_ENV = {
  CLOUDFLARE_TUNNEL_API_TOKEN: "cf-account-token-value-not-for-devices",
  CLOUDFLARE_TUNNEL_ACCOUNT_ID: "acct_123",
  CLOUDFLARE_TUNNEL_ZONE_ID: "zone_123",
  RELAY_HOSTNAME_SUFFIX: "relay.mailwarden.app",
};

/** Configure the way a deployment does: through the environment, then re-parse. */
function configureManagedTunnels(values: Record<string, string | undefined> = CLOUD_ENV) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else process.env[key] = value;
  }
  updateConfig({});
}

beforeEach(() => {
  api = new FakeCloudflareApi();
  configureManagedTunnels();
});

afterEach(() => {
  configureManagedTunnels({
    CLOUDFLARE_TUNNEL_API_TOKEN: undefined,
    CLOUDFLARE_TUNNEL_ACCOUNT_ID: undefined,
    CLOUDFLARE_TUNNEL_ZONE_ID: undefined,
    RELAY_HOSTNAME_SUFFIX: undefined,
  });
});

const service = () => new CloudflareTunnelService(() => api);

describe("local service validation", () => {
  test("accepts a loopback gateway and normalizes it", () => {
    expect(validateLocalService("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(validateLocalService("http://localhost:9000/")).toBe("http://localhost:9000");
    expect(validateLocalService(undefined)).toBe("http://127.0.0.1:8080");
  });

  test("refuses to publish anything but loopback", () => {
    // A managed tunnel pointed at a LAN address would be a pivot into the
    // customer's network, published on a Mailwarden hostname.
    expect(() => validateLocalService("http://192.168.1.10:8080")).toThrow(/loopback/i);
    expect(() => validateLocalService("http://169.254.169.254/")).toThrow(/loopback/i);
    expect(() => validateLocalService("http://internal.corp:8080")).toThrow(/loopback/i);
    expect(() => validateLocalService("ssh://127.0.0.1:22")).toThrow(/HTTP/i);
    expect(() => validateLocalService("http://127.0.0.1:8080/admin")).toThrow(/path/i);
    expect(() => validateLocalService("not a url")).toThrow(/URL/i);
  });
});

describe("hostname derivation", () => {
  test("produces a valid DNS label from a nanoid device id", () => {
    const hostname = relayHostname("F4O4N-2ThHjrKziuM5Fdg", "relay.mailwarden.app");
    expect(hostname).toBe("mw-f4o4n-2thhjrkzium5fdg.relay.mailwarden.app");
    // Underscores are not legal in a hostname label.
    expect(relayHostname("ab_cd_ef", "relay.mailwarden.app")).toBe("mw-ab-cd-ef.relay.mailwarden.app");
    expect(relayHostname("x", "relay.mailwarden.app").split(".")[0]!.length).toBeLessThanOrEqual(63);
  });
});

describe("provisioning", () => {
  test("creates the tunnel, publishes the hostname, and returns only the run token", async () => {
    const result = await service().provision({
      deviceId: "dev1",
      organizationId: "org1",
      localService: "http://127.0.0.1:8080",
    });

    expect(result!.hostname).toBe("mw-dev1.relay.mailwarden.app");
    expect(result!.token.startsWith("eyJ-run-token-")).toBe(true);
    // The account token must never appear in what a device receives.
    expect(JSON.stringify(result)).not.toContain("cf-account-token-value-not-for-devices");

    expect(api.tunnels.get(result!.tunnelId)?.ingress).toEqual({
      hostname: "mw-dev1.relay.mailwarden.app",
      service: "http://127.0.0.1:8080",
    });
    expect(api.dns.get("mw-dev1.relay.mailwarden.app")).toBe(`${result!.tunnelId}.cfargotunnel.com`);
  });

  test("reuses an existing tunnel and re-applies ingress for a changed port", async () => {
    const first = await service().provision({
      deviceId: "dev2",
      organizationId: "org1",
      localService: "http://127.0.0.1:8080",
    });
    api.calls.length = 0;

    const again = await service().provision({
      deviceId: "dev2",
      organizationId: "org1",
      localService: "http://127.0.0.1:9999",
      existing: { tunnelId: first!.tunnelId, hostname: first!.hostname },
    });

    expect(again!.tunnelId).toBe(first!.tunnelId);
    expect(api.calls.some((call) => call.startsWith("create:"))).toBe(false);
    expect(api.tunnels.get(first!.tunnelId)?.ingress?.service).toBe("http://127.0.0.1:9999");
  });

  test("does not leave an orphan tunnel behind a failed setup", async () => {
    api.failIngress = true;
    await expect(
      service().provision({ deviceId: "dev3", organizationId: "org1", localService: "http://127.0.0.1:8080" })
    ).rejects.toThrow(/ingress rejected/);
    expect(api.calls.some((call) => call.startsWith("delete:"))).toBe(true);
    expect(api.tunnels.size).toBe(0);
  });

  test("reports itself unconfigured rather than pretending", async () => {
    configureManagedTunnels({ CLOUDFLARE_TUNNEL_API_TOKEN: undefined });
    expect(service().isConfigured()).toBe(false);
    expect(
      await service().provision({ deviceId: "dev4", organizationId: "org1", localService: "http://127.0.0.1:8080" })
    ).toBeNull();
  });

  test("release removes the hostname and the tunnel", async () => {
    const created = await service().provision({
      deviceId: "dev5",
      organizationId: "org1",
      localService: "http://127.0.0.1:8080",
    });
    expect(await service().release(created!.tunnelId, created!.hostname)).toBe(true);
    expect(api.dns.has(created!.hostname)).toBe(false);
    expect(api.tunnels.has(created!.tunnelId)).toBe(false);
  });

  test("release failure is reported, not thrown, so revocation still completes", async () => {
    const failing = new CloudflareTunnelService(() => ({
      ...api,
      deleteTunnel: async () => {
        throw new Error("cloudflare down");
      },
    }) as unknown as CloudflareTunnelApi);
    expect(await failing.release("tun_x", "host.example")).toBe(false);
  });
});

describe("device lifecycle with managed tunnels", () => {
  async function teamDevice(label: string) {
    const email = `${label}-${nanoid()}@example.com`;
    const created = await authService.createTenantAndOwner({
      tenantName: `${label} Personal`,
      slug: `${label.toLowerCase()}-${nanoid()}`,
      ownerEmail: email,
      ownerDisplayName: label,
    });
    const personal: AuthPrincipal = {
      workspaceId: created.tenantId,
      tenantId: created.tenantId,
      userId: created.userId,
      scopes: ALL_SCOPES,
      role: "owner",
    } as AuthPrincipal;
    const context = await organizationService.createOrganization(personal, { name: `${label} ${nanoid(6)}` });
    const principal = { ...personal, workspaceId: context.workspace.id, tenantId: context.workspace.id } as AuthPrincipal;

    const start = await relayDeviceService.startProvisioning({
      deviceName: `${label}-relay`,
      platform: "linux-x64",
      version: "0.1.0",
      capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
    });
    await relayDeviceService.authorizeProvisioning(principal, context.workspace.id, start.userCode);
    const poll = await relayDeviceService.pollProvisioning(start.deviceCode);
    return { principal, organizationId: context.workspace.id, credential: poll.credential! };
  }

  test("a device gets a tunnel, it is persisted once, and revoking releases it", async () => {
    const fake = api;
    // Point the shared service that relay-devices uses at the fake Cloudflare API.
    const { cloudflareTunnelService } = await import("../src/services/cloudflare-tunnels");
    const realFactory = (cloudflareTunnelService as any).apiFactory;
    (cloudflareTunnelService as any).apiFactory = () => fake;

    try {
      const device = await teamDevice("Tunnelled");
      const credential = await relayDeviceService.getTunnelCredential(
        device.credential.deviceSecret,
        device.credential.deviceId,
        "http://127.0.0.1:8123"
      );

      expect(credential?.hostname).toContain(".relay.mailwarden.app");
      expect(credential?.token.startsWith("eyJ-run-token-")).toBe(true);

      const [row] = await db
        .select()
        .from(schema.relayDevices)
        .where(eq(schema.relayDevices.id, device.credential.deviceId))
        .limit(1);
      expect(row!.tunnelId).toBe(credential!.tunnelId);
      expect(row!.tunnelHostname).toBe(credential!.hostname);
      // The run token is deliberately not persisted by Cloud.
      expect(JSON.stringify(row)).not.toContain(credential!.token);

      // Asking again reuses the same tunnel.
      const again = await relayDeviceService.getTunnelCredential(
        device.credential.deviceSecret,
        device.credential.deviceId,
        "http://127.0.0.1:8123"
      );
      expect(again!.tunnelId).toBe(credential!.tunnelId);
      expect(fake.calls.filter((call) => call.startsWith("create:")).length).toBe(1);

      // Revoking the device takes the hostname down with it.
      await relayDeviceService.revokeDevice(device.principal, device.organizationId, device.credential.deviceId);
      expect(fake.dns.has(credential!.hostname)).toBe(false);
      expect(fake.tunnels.has(credential!.tunnelId)).toBe(false);
    } finally {
      (cloudflareTunnelService as any).apiFactory = realFactory;
    }
  });

  test("a device cannot ask for a tunnel that points off the loopback", async () => {
    const fake = api;
    const { cloudflareTunnelService } = await import("../src/services/cloudflare-tunnels");
    (cloudflareTunnelService as any).apiFactory = () => fake;

    const device = await teamDevice("Pivot");
    await expect(
      relayDeviceService.getTunnelCredential(
        device.credential.deviceSecret,
        device.credential.deviceId,
        "http://10.0.0.5:80"
      )
    ).rejects.toThrow(/loopback/i);
    expect(fake.calls.some((call) => call.startsWith("create:"))).toBe(false);
  });
});

describe("cleanup ledger", () => {
  test("a failed release is recorded and later reconciled", async () => {
    const orphanId = nanoid(8);
    const created = await service().provision({
      deviceId: `dev-orphan-${orphanId}`,
      organizationId: `org-orphan-${orphanId}`,
      localService: "http://127.0.0.1:8080",
    });

    // Cloudflare is unreachable at revocation time.
    let cloudflareDown = true;
    const flaky = new CloudflareTunnelService(
      () =>
        ({
          ...api,
          deleteDnsRecord: async (hostname: string) => {
            if (cloudflareDown) throw new Error("cloudflare unreachable");
            return api.deleteDnsRecord(hostname);
          },
          deleteTunnel: async (tunnelId: string) => {
            if (cloudflareDown) throw new Error("cloudflare unreachable");
            return api.deleteTunnel(tunnelId);
          },
        }) as unknown as CloudflareTunnelApi
    );

    const released = await flaky.release(created!.tunnelId, created!.hostname, {
      tenantId: `org-orphan-${orphanId}`,
      deviceId: `dev-orphan-${orphanId}`,
    });
    // Revocation is not blocked by the outage, but the orphan is recorded.
    expect(released).toBe(false);
    expect(await flaky.pendingCleanupCount()).toBeGreaterThan(0);

    const [queued] = await db
      .select()
      .from(schema.relayTunnelCleanup)
      .where(eq(schema.relayTunnelCleanup.tunnelId, created!.tunnelId));
    expect(queued!.lastError).toContain("cloudflare unreachable");
    expect(queued!.attempts).toBe(1);

    // A retry too soon is skipped by the back-off.
    expect(await flaky.reconcile(20, new Date())).toEqual({ attempted: 0, released: 0 });

    // Once Cloudflare recovers, the next pass finishes the job.
    cloudflareDown = false;
    const later = new Date(Date.now() + 20 * 60_000);
    const result = await flaky.reconcile(20, later);
    expect(result.released).toBeGreaterThan(0);
    expect(api.tunnels.has(created!.tunnelId)).toBe(false);
    expect(api.dns.has(created!.hostname)).toBe(false);

    const [settled] = await db
      .select()
      .from(schema.relayTunnelCleanup)
      .where(eq(schema.relayTunnelCleanup.tunnelId, created!.tunnelId));
    expect(settled!.releasedAt).toBeTruthy();
    expect(settled!.lastError).toBeNull();

    // A released row is not attempted again.
    expect((await flaky.reconcile(20, new Date(later.getTime() + 60 * 60_000))).attempted).toBe(0);
  });

  test("repeated failures increment attempts instead of duplicating rows", async () => {
    const failing = new CloudflareTunnelService(
      () =>
        ({
          ...api,
          deleteDnsRecord: async () => {
            throw new Error("still down");
          },
          deleteTunnel: async () => {
            throw new Error("still down");
          },
        }) as unknown as CloudflareTunnelApi
    );
    // Unique per run: the test database persists, and this assertion is about
    // what these two calls did, not what every previous run left behind.
    const tunnelId = `tun_retry_${nanoid(8)}`;
    const owner = { tenantId: "org-retry", deviceId: "dev-retry" };
    await failing.release(tunnelId, "retry.relay.mailwarden.app", owner);
    await failing.release(tunnelId, "retry.relay.mailwarden.app", owner);

    const rows = await db
      .select()
      .from(schema.relayTunnelCleanup)
      .where(eq(schema.relayTunnelCleanup.tunnelId, tunnelId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.attempts).toBe(2);
  });

  test("reconciliation does nothing when managed tunnels are not configured", async () => {
    configureManagedTunnels({ CLOUDFLARE_TUNNEL_API_TOKEN: undefined });
    expect(await service().reconcile()).toEqual({ attempted: 0, released: 0 });
  });
});
