import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type { ProtonConnectorInfo } from "../types/policy";
import { authService } from "./auth";
import { auditService } from "./audit";
import { nanoid } from "nanoid";
import { hashToken } from "../utils/hash";
import { ValidationError, NotFoundError, TenantIsolationError } from "../utils/errors";
import { localizationService, type SupportedLocale } from "./localization";

export class ProtonConnectorService {
  /**
   * Registers a new local connector device or hosted gateway for a Proton account
   */
  async registerConnector(
    principal: AuthPrincipal,
    params: {
      accountId: string;
      deviceName: string;
      connectorType?: "local_connector" | "hosted_gateway";
      bridgeHost?: string;
      bridgeImapPort?: number;
      bridgeSmtpPort?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<{ connector: ProtonConnectorInfo; rawDeviceToken: string }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "accounts.manage");

    // Verify account ownership and that provider is proton
    const [account] = await db
      .select()
      .from(schema.emailAccounts)
      .where(
        and(
          eq(schema.emailAccounts.id, params.accountId),
          eq(schema.emailAccounts.tenantId, principal.tenantId),
          eq(schema.emailAccounts.userId, principal.userId)
        )
      )
      .limit(1);

    if (!account) {
      throw new NotFoundError("Email account", params.accountId);
    }

    if (account.provider !== "proton") {
      throw new ValidationError(`Account ${params.accountId} is not a Proton account`);
    }

    const rawDeviceToken = `mwp_${nanoid(32)}`;
    const deviceTokenHash = await hashToken(rawDeviceToken);
    const now = new Date();
    const id = nanoid();

    // Check if connector already exists for this account
    const [existing] = await db
      .select()
      .from(schema.protonConnectors)
      .where(
        and(
          eq(schema.protonConnectors.accountId, params.accountId),
          eq(schema.protonConnectors.tenantId, principal.tenantId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.protonConnectors)
        .set({
          deviceName: params.deviceName,
          connectorType: params.connectorType || "local_connector",
          deviceTokenHash,
          status: "online",
          bridgeHost: params.bridgeHost || "127.0.0.1",
          bridgeImapPort: params.bridgeImapPort || 1143,
          bridgeSmtpPort: params.bridgeSmtpPort || 1025,
          lastSeenAt: now,
          metadata: params.metadata || null,
          updatedAt: now,
        })
        .where(eq(schema.protonConnectors.id, existing.id));

      const updated = await this.getConnectorByAccountId(principal, params.accountId);
      return { connector: updated!, rawDeviceToken };
    }

    await db.insert(schema.protonConnectors).values({
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId: params.accountId,
      connectorType: params.connectorType || "local_connector",
      deviceName: params.deviceName,
      deviceTokenHash,
      status: "online",
      bridgeHost: params.bridgeHost || "127.0.0.1",
      bridgeImapPort: params.bridgeImapPort || 1143,
      bridgeSmtpPort: params.bridgeSmtpPort || 1025,
      lastSeenAt: now,
      metadata: params.metadata || null,
      createdAt: now,
      updatedAt: now,
    });

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "PROTON_CONNECTOR_REGISTERED",
      resourceType: "proton_connector",
      resourceId: id,
      details: { accountId: params.accountId, deviceName: params.deviceName },
    });

    const created = await this.getConnectorByAccountId(principal, params.accountId);
    return { connector: created!, rawDeviceToken };
  }

  /**
   * Processes a heartbeat from a local connector using its device token
   */
  async processHeartbeat(
    rawDeviceToken: string,
    statusUpdates?: { status?: "online" | "syncing" | "error"; errorMessage?: string; metadata?: any }
  ): Promise<{ success: boolean; accountId: string }> {
    const tokenHash = await hashToken(rawDeviceToken);

    const [connector] = await db
      .select()
      .from(schema.protonConnectors)
      .where(eq(schema.protonConnectors.deviceTokenHash, tokenHash))
      .limit(1);

    if (!connector) {
      throw new ValidationError("Invalid or revoked Proton connector device token");
    }

    const now = new Date();
    await db
      .update(schema.protonConnectors)
      .set({
        status: statusUpdates?.status || "online",
        errorMessage: statusUpdates?.errorMessage || null,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(schema.protonConnectors.id, connector.id));

    return { success: true, accountId: connector.accountId };
  }

  /**
   * Retrieves connector information for an account (strictly tenant-scoped)
   */
  async getConnectorByAccountId(
    principal: AuthPrincipal,
    accountId: string
  ): Promise<ProtonConnectorInfo | null> {
    authService.requirePrincipal(principal);

    const [row] = await db
      .select()
      .from(schema.protonConnectors)
      .where(
        and(
          eq(schema.protonConnectors.accountId, accountId),
          eq(schema.protonConnectors.tenantId, principal.tenantId),
          eq(schema.protonConnectors.userId, principal.userId)
        )
      )
      .limit(1);

    if (!row) return null;

    // Check if connector is considered offline (lastSeenAt older than 5 minutes)
    const isStale = !row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 5 * 60 * 1000;
    const computedStatus = isStale ? "offline" : row.status;

    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      accountId: row.accountId,
      connectorType: row.connectorType as any,
      deviceName: row.deviceName,
      status: computedStatus as any,
      bridgeHost: row.bridgeHost,
      bridgeImapPort: row.bridgeImapPort,
      bridgeSmtpPort: row.bridgeSmtpPort,
      lastSeenAt: row.lastSeenAt || undefined,
      errorMessage: row.errorMessage || undefined,
      metadata: row.metadata ? (row.metadata as Record<string, any>) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Formats human-readable status for a Proton account
   */
  formatConnectorStatus(connector: ProtonConnectorInfo | null, locale: SupportedLocale = "en"): {
    statusText: string;
    isOnline: boolean;
    warningMessage?: string;
  } {
    const content = localizationService.getContent(locale);

    if (!connector) {
      return {
        statusText: locale === "pt-BR" ? "Não configurado" : "Not configured",
        isOnline: false,
        warningMessage:
          locale === "pt-BR"
            ? "O conector do Proton não está configurado."
            : "Proton connector is not configured.",
      };
    }

    if (connector.status === "online" || connector.status === "syncing") {
      const timeAgo = connector.lastSeenAt
        ? localizationService.formatTimeAgo(connector.lastSeenAt, locale)
        : "just now";
      return {
        statusText: content.providerStatus.lastSeen(connector.deviceName, timeAgo),
        isOnline: true,
      };
    }

    const timeAgo = connector.lastSeenAt
      ? localizationService.formatTimeAgo(connector.lastSeenAt, locale)
      : "some time ago";

    return {
      statusText: `${content.providerStatus.offline} (${connector.deviceName} - ${timeAgo})`,
      isOnline: false,
      warningMessage: content.providerStatus.offlineWarning("Proton", connector.deviceName, timeAgo),
    };
  }
}

export const protonConnectorService = new ProtonConnectorService();
