import { createHash } from "crypto";
import { and, count, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { getPlanCapabilities } from "@mailwarden/organizations";
import type {
  BridgeHealth,
  PlanId,
  RelayDevice,
  RelayDeviceCredential,
  RelayHeartbeatResponse,
  RelayProvisioningPollResponse,
  RelayProvisioningStartRequest,
  RelayProvisioningStartResponse,
} from "@mailwarden/contracts";
import { config } from "../config";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import { AuthenticationError, AuthorizationError, NotFoundError, RateLimitError, ValidationError } from "../utils/errors";
import { auditService } from "./audit";
import { encryptionService, type EnvelopeEncryptedPayload } from "./encryption";
import { organizationService } from "./organizations";

const userCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const credentialTtlMs = 90 * 24 * 60 * 60 * 1000;
/** Tunable so an operator can tighten it without a deploy of new logic. */
function maxProvisioningStartsPerMinute(): number {
  const configured = Number(process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE);
  // A coarse backstop on an unauthenticated endpoint: two sessions a second is
  // far below any abuse worth worrying about and far above real onboarding, which
  // is one session per machine.
  return Number.isFinite(configured) && configured > 0 ? configured : 120;
}
/** Keep expired sessions briefly so a late poll still gets "expired", not "unknown". */
const PROVISIONING_RETENTION_MS = 60 * 60 * 1000;

function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function mapDevice(row: typeof schema.relayDevices.$inferSelect): RelayDevice {
  return {
    id: row.id,
    organizationId: row.tenantId,
    name: row.name,
    platform: row.platform,
    version: row.version,
    protocolVersion: row.protocolVersion,
    status: row.status,
    createdBy: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString(),
    revokedAt: row.revokedAt?.toISOString(),
    capabilities: row.capabilities as unknown as RelayDevice["capabilities"],
    health: row.lastHealth as unknown as RelayDevice["health"],
  };
}

export class RelayDeviceService {
  /**
   * Provisioning starts on an unauthenticated endpoint — the device has no
   * credential yet — so it is bounded here rather than left open. The window is
   * global rather than per caller: an attacker controls their own source address,
   * and Mailwarden would rather slow everyone briefly than mint unbounded
   * sessions. Legitimate setup runs once per machine.
   */
  private async guardProvisioningRate(now: Date): Promise<void> {
    const [recent] = await db
      .select({ total: count() })
      .from(schema.relayProvisioningSessions)
      .where(gt(schema.relayProvisioningSessions.createdAt, new Date(now.getTime() - 60_000)));
    if ((recent?.total ?? 0) >= maxProvisioningStartsPerMinute()) {
      throw new RateLimitError("Too many Bridge provisioning requests; try again in a minute");
    }
  }

  /** Expired sessions carry no value and should not accumulate. */
  private async purgeExpiredProvisioning(now: Date): Promise<void> {
    await db
      .delete(schema.relayProvisioningSessions)
      .where(lt(schema.relayProvisioningSessions.expiresAt, new Date(now.getTime() - PROVISIONING_RETENTION_MS)));
  }

  async startProvisioning(input: RelayProvisioningStartRequest): Promise<RelayProvisioningStartResponse> {
    const startedAt = new Date();
    await this.guardProvisioningRate(startedAt);
    await this.purgeExpiredProvisioning(startedAt);
    const deviceCode = `mwrp_${nanoid(48)}`;
    const compactUserCode = userCode();
    const displayUserCode = `${compactUserCode.slice(0, 4)}-${compactUserCode.slice(4)}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const id = nanoid();
    await db.insert(schema.relayProvisioningSessions).values({
      id,
      deviceCodeHash: hash(deviceCode),
      userCodeHash: hash(compactUserCode),
      deviceName: input.deviceName.trim(),
      platform: input.platform.trim(),
      version: input.version.trim(),
      protocolVersion: input.protocolVersion || 1,
      capabilities: input.capabilities,
      state: "pending",
      expiresAt,
      createdAt: new Date(),
    });
    await auditService.logEvent({
      tenantId: "system",
      action: "RELAY_PROVISIONING_STARTED",
      resourceType: "relay_provisioning",
      resourceId: id,
      details: { platform: input.platform, protocolVersion: input.protocolVersion || 1 },
    });

    return {
      deviceCode,
      userCode: displayUserCode,
      verificationUri: `${config.APP_BASE_URL}/portal?tab=devices`,
      verificationUriComplete: `${config.APP_BASE_URL}/portal?tab=devices&user_code=${encodeURIComponent(displayUserCode)}`,
      expiresAt: expiresAt.toISOString(),
      intervalSeconds: 5,
    };
  }

  async authorizeProvisioning(principal: AuthPrincipal, organizationId: string, code: string) {
    const context = await organizationService.requireWorkspaceMembership(principal, organizationId, "admin");
    if (context.workspace.kind !== "team") throw new ValidationError("Relay devices belong to Team Organizations");
    const capabilities = getPlanCapabilities(context.workspace.plan);
    if (!capabilities.sharedProtonRelay || capabilities.maxRelayDevices < 1) {
      throw new AuthorizationError("Current plan does not include a shared Proton relay");
    }
    const active = await db.select({ id: schema.relayDevices.id }).from(schema.relayDevices).where(and(
      eq(schema.relayDevices.tenantId, organizationId), isNull(schema.relayDevices.revokedAt)
    ));
    if (active.length >= capabilities.maxRelayDevices) throw new AuthorizationError("Relay device limit reached");

    const now = new Date();
    const [authorized] = await db.update(schema.relayProvisioningSessions).set({
      tenantId: organizationId,
      state: "authorized",
      authorizedByUserId: principal.userId,
      authorizedAt: now,
    }).where(and(
      eq(schema.relayProvisioningSessions.userCodeHash, hash(normalizeUserCode(code))),
      eq(schema.relayProvisioningSessions.state, "pending"),
      isNull(schema.relayProvisioningSessions.consumedAt),
      gt(schema.relayProvisioningSessions.expiresAt, now)
    )).returning();
    if (!authorized) throw new ValidationError("Provisioning code is invalid, expired, or already authorized");

    await auditService.logEvent({
      tenantId: organizationId,
      userId: principal.userId,
      action: "RELAY_PROVISIONING_AUTHORIZED",
      resourceType: "relay_provisioning",
      resourceId: authorized.id,
      details: { platform: authorized.platform, protocolVersion: authorized.protocolVersion },
    });
    return { authorized: true, expiresAt: authorized.expiresAt.toISOString() };
  }

  async pollProvisioning(deviceCode: string): Promise<RelayProvisioningPollResponse> {
    const [session] = await db.select().from(schema.relayProvisioningSessions).where(
      eq(schema.relayProvisioningSessions.deviceCodeHash, hash(String(deviceCode || "")))
    ).limit(1);
    if (!session) return { state: "denied", reason: "Unknown provisioning request" };
    if (session.expiresAt <= new Date()) {
      await db.update(schema.relayProvisioningSessions).set({ state: "expired" }).where(eq(schema.relayProvisioningSessions.id, session.id));
      return { state: "expired" };
    }
    if (session.state !== "authorized") return { state: session.state };
    if (!session.tenantId || !session.authorizedByUserId) return { state: "denied", reason: "Provisioning approval is incomplete" };
    if (session.consumedAt) {
      const [device] = session.relayDeviceId
        ? await db.select().from(schema.relayDevices).where(eq(schema.relayDevices.id, session.relayDeviceId)).limit(1)
        : [];
      return { state: "authorized", device: device ? mapDevice(device) : undefined, reason: "Credential was already delivered; restart provisioning if it was not saved" };
    }

    const deviceId = nanoid();
    const now = new Date();
    try {
      await db.insert(schema.relayDevices).values({
        id: deviceId,
        tenantId: session.tenantId,
        name: session.deviceName,
        platform: session.platform,
        version: session.version,
        protocolVersion: session.protocolVersion,
        status: "offline",
        capabilities: session.capabilities,
        createdByUserId: session.authorizedByUserId,
        createdAt: now,
        updatedAt: now,
      });
      const [claimed] = await db.update(schema.relayProvisioningSessions).set({ consumedAt: now, relayDeviceId: deviceId }).where(and(
        eq(schema.relayProvisioningSessions.id, session.id), isNull(schema.relayProvisioningSessions.consumedAt)
      )).returning();
      if (!claimed) {
        await db.delete(schema.relayDevices).where(eq(schema.relayDevices.id, deviceId));
        return this.pollProvisioning(deviceCode);
      }
      const credential = await this.issueCredential(session.tenantId, deviceId, false);
      const [device] = await db.select().from(schema.relayDevices).where(eq(schema.relayDevices.id, deviceId)).limit(1);
      await auditService.logEvent({
        tenantId: session.tenantId,
        userId: session.authorizedByUserId,
        action: "RELAY_REGISTERED",
        resourceType: "relay_device",
        resourceId: deviceId,
        details: { platform: session.platform, protocolVersion: session.protocolVersion },
      });
      return { state: "authorized", device: mapDevice(device), credential };
    } catch (error) {
      await db.delete(schema.relayDevices).where(eq(schema.relayDevices.id, deviceId));
      await db.update(schema.relayProvisioningSessions).set({ consumedAt: null, relayDeviceId: null }).where(eq(schema.relayProvisioningSessions.id, session.id));
      throw error;
    }
  }

  async heartbeat(deviceSecret: string, health: BridgeHealth): Promise<RelayHeartbeatResponse> {
    const auth = await this.findCredential(deviceSecret);
    if (!auth || auth.credential.revokedAt || auth.credential.expiresAt <= new Date() || auth.device.revokedAt) {
      return { state: auth ? "revoked" : "unknown_device" };
    }
    if (health.deviceId && health.deviceId !== auth.device.id) throw new AuthenticationError("Heartbeat device identity mismatch");
    if (health.organizationId && health.organizationId !== auth.device.tenantId) throw new AuthenticationError("Heartbeat organization mismatch");

    const now = new Date();
    await db.update(schema.relayDevices).set({
      status: health.status,
      version: health.version.version,
      platform: health.version.platform,
      protocolVersion: health.version.protocol,
      lastHealth: health,
      lastSeenAt: now,
      updatedAt: now,
    }).where(eq(schema.relayDevices.id, auth.device.id));
    await auditService.logEvent({
      tenantId: auth.device.tenantId,
      action: "RELAY_HEARTBEAT",
      resourceType: "relay_device",
      resourceId: auth.device.id,
      details: { status: health.status, protocolVersion: health.version.protocol, connectedAccounts: health.accounts.connected },
    });
    return { state: "ok", nextHeartbeatSeconds: 30 };
  }

  async listDevices(principal: AuthPrincipal, organizationId: string): Promise<RelayDevice[]> {
    await organizationService.requireWorkspaceMembership(principal, organizationId);
    const rows = await db.select().from(schema.relayDevices).where(eq(schema.relayDevices.tenantId, organizationId));
    return rows.map(mapDevice);
  }

  async revokeDevice(principal: AuthPrincipal, organizationId: string, deviceId: string) {
    await organizationService.requireWorkspaceMembership(principal, organizationId, "admin");
    const now = new Date();
    const [device] = await db.update(schema.relayDevices).set({ revokedAt: now, status: "offline", updatedAt: now }).where(and(
      eq(schema.relayDevices.id, deviceId), eq(schema.relayDevices.tenantId, organizationId), isNull(schema.relayDevices.revokedAt)
    )).returning();
    if (!device) throw new NotFoundError("Active relay device", deviceId);
    await db.update(schema.relayDeviceCredentials).set({ revokedAt: now }).where(and(
      eq(schema.relayDeviceCredentials.deviceId, deviceId), isNull(schema.relayDeviceCredentials.revokedAt)
    ));
    await auditService.logEvent({ tenantId: organizationId, userId: principal.userId, action: "RELAY_REVOKED", resourceType: "relay_device", resourceId: deviceId });
    return mapDevice(device);
  }

  async rotateCredential(principal: AuthPrincipal, organizationId: string, deviceId: string): Promise<RelayDeviceCredential> {
    await organizationService.requireWorkspaceMembership(principal, organizationId, "admin");
    const [device] = await db.select().from(schema.relayDevices).where(and(
      eq(schema.relayDevices.id, deviceId), eq(schema.relayDevices.tenantId, organizationId), isNull(schema.relayDevices.revokedAt)
    )).limit(1);
    if (!device) throw new NotFoundError("Active relay device", deviceId);
    const credential = await this.issueCredential(organizationId, deviceId, true);
    await auditService.logEvent({ tenantId: organizationId, userId: principal.userId, action: "RELAY_CREDENTIAL_ROTATED", resourceType: "relay_device", resourceId: deviceId, details: { generation: credential.generation } });
    return credential;
  }

  async renewDeviceCredential(deviceSecret: string, deviceId: string, generation: number): Promise<RelayDeviceCredential> {
    const auth = await this.requireActiveCredential(deviceSecret, deviceId, generation);
    const credential = await this.issueCredential(auth.device.tenantId, auth.device.id, true);
    await auditService.logEvent({
      tenantId: auth.device.tenantId,
      action: "RELAY_CREDENTIAL_ROTATED",
      resourceType: "relay_device",
      resourceId: auth.device.id,
      details: { generation: credential.generation, initiatedBy: "device" },
    });
    return credential;
  }

  async getTunnelCredential(deviceSecret: string, deviceId: string) {
    await this.requireActiveCredential(deviceSecret, deviceId);
    return null;
  }

  async getGatewaySecret(organizationId: string, deviceId: string): Promise<string> {
    const [row] = await db.select().from(schema.relayDeviceCredentials).where(and(
      eq(schema.relayDeviceCredentials.tenantId, organizationId),
      eq(schema.relayDeviceCredentials.deviceId, deviceId),
      isNull(schema.relayDeviceCredentials.revokedAt),
      gt(schema.relayDeviceCredentials.expiresAt, new Date())
    )).limit(1);
    if (!row) throw new NotFoundError("Active relay credential", deviceId);
    return encryptionService.decryptJson<{ gatewaySecret: string }>(
      row.encryptedGatewaySecret as unknown as EnvelopeEncryptedPayload,
      { tenantId: organizationId }
    ).gatewaySecret;
  }

  private async issueCredential(organizationId: string, deviceId: string, revokeExisting: boolean): Promise<RelayDeviceCredential> {
    const now = new Date();
    const rows = await db.select().from(schema.relayDeviceCredentials).where(eq(schema.relayDeviceCredentials.deviceId, deviceId));
    const generation = rows.reduce((max: number, row: any) => Math.max(max, row.generation), 0) + 1;
    const deviceSecret = `mwrd_${nanoid(48)}`;
    const gatewaySecret = `mwrg_${nanoid(48)}`;
    const expiresAt = new Date(now.getTime() + credentialTtlMs);
    const credentialId = nanoid();
    await db.insert(schema.relayDeviceCredentials).values({
      id: credentialId,
      tenantId: organizationId,
      deviceId,
      generation,
      deviceSecretHash: hash(deviceSecret),
      encryptedGatewaySecret: encryptionService.encryptJson({ gatewaySecret }, { tenantId: organizationId }),
      expiresAt,
      createdAt: now,
    });
    if (revokeExisting) {
      try {
        await db.update(schema.relayDeviceCredentials).set({ revokedAt: now }).where(and(
          eq(schema.relayDeviceCredentials.deviceId, deviceId),
          ne(schema.relayDeviceCredentials.id, credentialId),
          isNull(schema.relayDeviceCredentials.revokedAt)
        ));
      } catch (error) {
        await db.delete(schema.relayDeviceCredentials).where(eq(schema.relayDeviceCredentials.id, credentialId));
        throw error;
      }
    }
    return { deviceId, organizationId, deviceSecret, gatewaySecret, issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), generation };
  }

  private async findCredential(deviceSecret: string) {
    if (!String(deviceSecret || "").startsWith("mwrd_")) return null;
    const [row] = await db.select({ credential: schema.relayDeviceCredentials, device: schema.relayDevices })
      .from(schema.relayDeviceCredentials)
      .innerJoin(schema.relayDevices, eq(schema.relayDevices.id, schema.relayDeviceCredentials.deviceId))
      .where(eq(schema.relayDeviceCredentials.deviceSecretHash, hash(deviceSecret)))
      .limit(1);
    return row || null;
  }

  private async requireActiveCredential(deviceSecret: string, deviceId: string, generation?: number) {
    const auth = await this.findCredential(deviceSecret);
    if (
      !auth ||
      auth.credential.revokedAt ||
      auth.credential.expiresAt <= new Date() ||
      auth.device.revokedAt ||
      auth.device.id !== deviceId ||
      (generation !== undefined && auth.credential.generation !== generation)
    ) {
      throw new AuthenticationError("Relay device credential is invalid or revoked");
    }
    return auth;
  }
}

export const relayDeviceService = new RelayDeviceService();
