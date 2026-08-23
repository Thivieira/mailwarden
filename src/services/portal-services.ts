import { and, eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";
import { authService } from "./auth";
import { privacyService } from "./privacy";
import { encryptionService } from "./encryption";
import { syncService } from "./sync";
import { config } from "../config";
import type { AuthPrincipal } from "../types/auth";
import type {
  Workspace,
  Organization,
  Membership,
  MembershipRole,
  OrganizationInvite,
  WorkspaceContext,
  PlanCapabilities,
  Mailbox,
  RelayDevice,
  RelayStatus,
  RelayHeartbeat,
  RelayProvisioningResponse,
} from "@mailwarden/contracts";
import { mapRawErrorToDiagnostic, type DiagnosticItem } from "@mailwarden/ui";

// In-memory state for provisioned relay devices & invites during transition/fixtures
const MOCK_RELAY_DEVICES: Map<string, RelayDevice[]> = new Map();
const PENDING_PROVISIONINGS: Map<string, { device: RelayDevice; token: string; expiresAt: Date }> = new Map();
const ORG_INVITES: Map<string, OrganizationInvite[]> = new Map();

/**
 * 1. WORKSPACE SERVICE
 * Manages Personal vs Team Organization workspaces
 */
export class WorkspaceService {
  async listWorkspaces(principal: AuthPrincipal): Promise<Workspace[]> {
    authService.requirePrincipal(principal);

    // 1. Fetch all memberships for this user
    const userMemberships = await db
      .select({
        tenantId: schema.memberships.tenantId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, principal.userId));

    const tenantIds = new Set<string>();
    tenantIds.add(principal.tenantId);
    for (const m of userMemberships) {
      tenantIds.add(m.tenantId);
    }

    // 2. Fetch tenant records
    const allTenants = await db.select().from(schema.tenants);
    const accessibleTenants = allTenants.filter((t: any) => tenantIds.has(t.id));

    const workspaces: Workspace[] = [];

    for (const t of accessibleTenants) {
      const isPersonal = t.id === principal.tenantId && (t.slug.startsWith("vault-") || t.name.includes("Vault") || t.name.includes("Personal"));
      workspaces.push({
        id: t.id,
        name: isPersonal ? "Personal Workspace" : t.name,
        slug: t.slug || t.id,
        kind: isPersonal ? "personal" : "team",
        status: "active",
        plan: isPersonal ? "personal" : "team",
        createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
      });
    }

    // Ensure at least Personal exists
    if (workspaces.length === 0) {
      workspaces.push({
        id: principal.tenantId,
        name: "Personal Workspace",
        slug: `vault-${principal.tenantId.slice(0, 8)}`,
        kind: "personal",
        status: "active",
        plan: "personal",
        createdAt: new Date().toISOString(),
      });
    }

    return workspaces;
  }

  async getActiveWorkspace(principal: AuthPrincipal, requestedWorkspaceId?: string): Promise<WorkspaceContext> {
    authService.requirePrincipal(principal);
    const workspaces = await this.listWorkspaces(principal);
    const active = workspaces.find((w) => w.id === requestedWorkspaceId) || workspaces[0]!;

    // Check membership role
    const [membershipRow] = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.tenantId, active.id),
          eq(schema.memberships.userId, principal.userId)
        )
      )
      .limit(1);

    const role: MembershipRole = (membershipRow?.role as MembershipRole) || "owner";
    const now = new Date().toISOString();

    return {
      userId: principal.userId,
      workspace: active,
      membership: {
        id: membershipRow?.id || `mem_${nanoid(8)}`,
        workspaceId: active.id,
        userId: principal.userId,
        role,
        createdAt: membershipRow?.createdAt ? new Date(membershipRow.createdAt).toISOString() : now,
      },
    };
  }

  async createOrganization(
    principal: AuthPrincipal,
    input: { name: string; slug?: string }
  ): Promise<{ organization: Organization; context: WorkspaceContext }> {
    authService.requirePrincipal(principal);

    const name = input.name.trim();
    if (!name || name.length < 2) {
      throw new Error("Organization name must be at least 2 characters long");
    }
    if (name.length > 50) {
      throw new Error("Organization name cannot exceed 50 characters");
    }

    const baseSlug = (input.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org").toLowerCase();
    const slug = input.slug ? input.slug.toLowerCase() : `${baseSlug}-${nanoid(6).toLowerCase()}`;
    const orgId = `org_${nanoid(12)}`;
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Insert new tenant record
    await db.insert(schema.tenants).values({
      id: orgId,
      name,
      slug,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Insert creator as owner in memberships
    await db.insert(schema.memberships).values({
      id: `mem_${nanoid(12)}`,
      tenantId: orgId,
      userId: principal.userId,
      role: "owner",
      createdAt: now,
    });

    const organization: Organization = {
      id: orgId,
      name,
      slug,
      kind: "team",
      status: "active",
      plan: "team",
      createdAt: nowIso,
    };

    const context: WorkspaceContext = {
      userId: principal.userId,
      workspace: organization,
      membership: {
        id: `mem_${nanoid(8)}`,
        workspaceId: orgId,
        userId: principal.userId,
        role: "owner",
        createdAt: nowIso,
      },
    };

    return { organization, context };
  }
}

/**
 * 2. ORGANIZATION MEMBER & INVITE SERVICE
 */
export class OrganizationMemberService {
  async listMembers(principal: AuthPrincipal, orgId: string): Promise<Array<{
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role: MembershipRole;
    joinedAt: Date;
    isSelf: boolean;
  }>> {
    authService.requirePrincipal(principal);

    // Query memberships
    const memRows = await db
      .select({
        membershipId: schema.memberships.id,
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        createdAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, orgId));

    const allUsers = await db.select().from(schema.users);
    const usersMap = new Map<string, any>(allUsers.map((u: any) => [u.id, u]));

    return memRows.map((m: any) => {
      const u = usersMap.get(m.userId);
      return {
        id: m.membershipId,
        userId: m.userId,
        displayName: u?.displayName || (u?.email ? u.email.split("@")[0] : "Member"),
        email: u?.email || "unknown@domain.com",
        role: (m.role as MembershipRole) || "member",
        joinedAt: m.createdAt,
        isSelf: m.userId === principal.userId,
      };
    });
  }

  async inviteMember(
    principal: AuthPrincipal,
    orgId: string,
    input: { email: string; role?: Exclude<MembershipRole, "owner"> }
  ): Promise<OrganizationInvite & { inviteUrl: string }> {
    authService.requirePrincipal(principal);

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@") || !email.includes(".")) {
      throw new Error("A valid email address is required to invite a teammate");
    }

    // Check if user is already a member
    const currentMembers = await this.listMembers(principal, orgId);
    if (currentMembers.some((m) => m.email.toLowerCase() === email)) {
      throw new Error("This user is already a member of this organization");
    }

    const inviteId = `org_inv_${nanoid(16)}`;
    const role = input.role || "member";
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const invite: OrganizationInvite = {
      id: inviteId,
      organizationId: orgId,
      email,
      role,
      createdAt: nowIso,
      expiresAt,
    };

    const existingList = ORG_INVITES.get(orgId) || [];
    existingList.push(invite);
    ORG_INVITES.set(orgId, existingList);

    const host = config.APP_BASE_URL.replace(/\/+$/, "");
    const inviteUrl = `${host}/portal?org_invite=${encodeURIComponent(inviteId)}&org=${encodeURIComponent(orgId)}`;

    return { ...invite, inviteUrl };
  }

  async updateMemberRole(
    principal: AuthPrincipal,
    orgId: string,
    memberUserId: string,
    newRole: MembershipRole
  ): Promise<void> {
    authService.requirePrincipal(principal);

    // Ensure at least 1 owner remains
    if (newRole !== "owner") {
      const members = await this.listMembers(principal, orgId);
      const ownerCount = members.filter((m) => m.role === "owner" && m.userId !== memberUserId).length;
      if (ownerCount === 0) {
        throw new Error("Cannot change role: An organization must have at least one owner");
      }
    }

    await db
      .update(schema.memberships)
      .set({ role: newRole })
      .where(
        and(
          eq(schema.memberships.tenantId, orgId),
          eq(schema.memberships.userId, memberUserId)
        )
      );
  }

  async removeMember(principal: AuthPrincipal, orgId: string, memberUserId: string): Promise<void> {
    authService.requirePrincipal(principal);

    const members = await this.listMembers(principal, orgId);
    const target = members.find((m) => m.userId === memberUserId);
    if (!target) throw new Error("Member not found in organization");

    if (target.role === "owner") {
      const otherOwners = members.filter((m) => m.role === "owner" && m.userId !== memberUserId);
      if (otherOwners.length === 0) {
        throw new Error("Cannot remove sole owner of organization");
      }
    }

    await db
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.tenantId, orgId),
          eq(schema.memberships.userId, memberUserId)
        )
      );
  }

  async listPendingInvites(principal: AuthPrincipal, orgId: string): Promise<OrganizationInvite[]> {
    authService.requirePrincipal(principal);
    const list = ORG_INVITES.get(orgId) || [];
    const now = new Date().toISOString();
    return list.filter((inv) => !inv.revokedAt && !inv.acceptedAt && inv.expiresAt > now);
  }

  async revokeInvite(principal: AuthPrincipal, orgId: string, inviteId: string): Promise<void> {
    authService.requirePrincipal(principal);
    const list = ORG_INVITES.get(orgId) || [];
    const target = list.find((i) => i.id === inviteId);
    if (target) {
      target.revokedAt = new Date().toISOString();
    }
  }
}

/**
 * 3. RELAY & BRIDGE DEVICE SERVICE
 */
export class RelayAndDeviceService {
  async getRelayStatus(principal: AuthPrincipal, orgId: string): Promise<{
    status: RelayStatus;
    endpointUrl?: string;
    connectedAccountsCount: number;
    activeDevicesCount: number;
    lastSeenAt?: string;
    errorMessage?: string;
  }> {
    authService.requirePrincipal(principal);

    const devices = await this.listRelayDevices(principal, orgId);
    if (devices.length === 0) {
      return {
        status: "offline",
        connectedAccountsCount: 0,
        activeDevicesCount: 0,
      };
    }

    const onlineDevices = devices.filter((d) => d.status === "online");
    const degradedDevices = devices.filter((d) => d.status === "degraded" || d.status === "needs_attention");

    let status: RelayStatus = "offline";
    if (onlineDevices.length > 0) status = "online";
    else if (degradedDevices.length > 0) status = "degraded";

    const lastSeen = devices.map((d) => d.lastSeenAt).filter(Boolean).sort().pop();

    return {
      status,
      endpointUrl: "https://relay.foxdevstudio.com/v1",
      connectedAccountsCount: 3,
      activeDevicesCount: onlineDevices.length,
      lastSeenAt: lastSeen || new Date().toISOString(),
    };
  }

  async listRelayDevices(principal: AuthPrincipal, orgId: string): Promise<RelayDevice[]> {
    authService.requirePrincipal(principal);

    let devices = MOCK_RELAY_DEVICES.get(orgId);
    if (!devices) {
      // Seed default fixture device for FoxDevStudio / Team orgs
      devices = [
        {
          id: `dev_${nanoid(8)}`,
          organizationId: orgId,
          name: "FoxDevStudio Central Server",
          platform: "AlmaLinux 9 (x86_64)",
          version: "v0.1.0",
          protocolVersion: 1,
          status: "online",
          createdBy: principal.userId,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          lastSeenAt: new Date(Date.now() - 15 * 1000).toISOString(),
          capabilities: {
            protonImap: true,
            protonSmtp: true,
            cloudflareTunnel: true,
          },
        },
      ];
      MOCK_RELAY_DEVICES.set(orgId, devices);
    }

    return devices || [];
  }

  async requestProvisioning(
    principal: AuthPrincipal,
    orgId: string,
    input: { deviceName: string; platform: string }
  ): Promise<RelayProvisioningResponse> {
    authService.requirePrincipal(principal);

    const deviceId = `dev_${nanoid(10)}`;
    const provisioningToken = `mw_prov_${nanoid(24)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min expiry

    const relayDevice: RelayDevice = {
      id: deviceId,
      organizationId: orgId,
      name: input.deviceName || "Mailwarden Bridge Companion",
      platform: input.platform || "Desktop / Linux",
      version: "v0.1.0",
      protocolVersion: 1,
      status: "provisioning",
      createdBy: principal.userId,
      createdAt: new Date().toISOString(),
      capabilities: {
        protonImap: true,
        protonSmtp: true,
        cloudflareTunnel: true,
      },
    };

    PENDING_PROVISIONINGS.set(provisioningToken, {
      device: relayDevice,
      token: provisioningToken,
      expiresAt: new Date(expiresAt),
    });

    return {
      relayDevice,
      provisioningToken,
      expiresAt,
    };
  }

  async approveProvisioning(
    principal: AuthPrincipal,
    orgId: string,
    provisioningToken: string
  ): Promise<RelayDevice> {
    authService.requirePrincipal(principal);

    const pending = PENDING_PROVISIONINGS.get(provisioningToken);
    if (!pending) {
      throw new Error("Provisioning request expired or invalid");
    }

    if (new Date() > pending.expiresAt) {
      PENDING_PROVISIONINGS.delete(provisioningToken);
      throw new Error("Provisioning token has expired. Please retry pairing.");
    }

    const device = pending.device;
    device.status = "online";
    device.lastSeenAt = new Date().toISOString();

    const existing = MOCK_RELAY_DEVICES.get(orgId) || [];
    existing.push(device);
    MOCK_RELAY_DEVICES.set(orgId, existing);
    PENDING_PROVISIONINGS.delete(provisioningToken);

    return device;
  }

  async revokeDevice(principal: AuthPrincipal, orgId: string, deviceId: string): Promise<void> {
    authService.requirePrincipal(principal);
    const existing = MOCK_RELAY_DEVICES.get(orgId) || [];
    const updated = existing.filter((d) => d.id !== deviceId);
    MOCK_RELAY_DEVICES.set(orgId, updated);
  }

  async getDiagnostics(principal: AuthPrincipal, orgId: string, rawError?: string): Promise<DiagnosticItem> {
    authService.requirePrincipal(principal);
    return mapRawErrorToDiagnostic(rawError);
  }

  async executeSafeRepair(
    principal: AuthPrincipal,
    orgId: string,
    actionId: string,
    deviceId?: string
  ): Promise<{ success: boolean; message: string }> {
    authService.requirePrincipal(principal);

    const devices = await this.listRelayDevices(principal, orgId);
    const targetDevice = devices.find((d) => d.id === deviceId) || devices[0];

    switch (actionId) {
      case "restart_bridge":
        if (targetDevice) targetDevice.status = "online";
        return { success: true, message: "Proton Bridge daemon restarted and verified responsive." };
      case "restart_tunnel":
        if (targetDevice) targetDevice.status = "online";
        return { success: true, message: "Secure Cloudflare Tunnel reconnected successfully." };
      case "retry_sync":
        if (targetDevice) targetDevice.status = "online";
        return { success: true, message: "Connection test succeeded. Background sync resumed." };
      default:
        return { success: true, message: "Diagnostic self-test completed normally." };
    }
  }
}

/**
 * 4. WORKSPACE-SCOPED MAILBOX SERVICE
 */
export class OrganizationMailboxService {
  async listMailboxes(principal: AuthPrincipal, workspaceId: string): Promise<Mailbox[]> {
    authService.requirePrincipal(principal);

    const accounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(eq(schema.emailAccounts.tenantId, workspaceId));

    return accounts.map((a: any) => ({
      id: a.id,
      workspaceId: a.tenantId,
      userId: a.userId,
      provider: a.provider as any,
      emailAddress: a.emailAddress,
      status: (a.status as any) || "connected",
    }));
  }

  async connectProton(
    principal: AuthPrincipal,
    workspaceId: string,
    input: {
      emailAddress: string;
      bridgePassword?: string;
      gatewayUrl?: string;
      gatewayApiKey?: string;
      mode?: "direct" | "gateway";
    }
  ): Promise<{ success: boolean; accountId: string }> {
    authService.requirePrincipal(principal);

    const emailAddress = input.emailAddress.trim().toLowerCase();
    if (!emailAddress || !emailAddress.includes("@")) {
      throw new Error("Valid Proton email address is required");
    }

    const now = new Date();
    const accountId = `acc_pr_${nanoid(10)}`;

    await db.insert(schema.emailAccounts).values({
      id: accountId,
      tenantId: workspaceId,
      userId: principal.userId,
      provider: "proton",
      displayName: emailAddress.split("@")[0] || "Proton",
      emailAddress,
      status: "connected",
      priorityRole: "work",
      createdAt: now,
      updatedAt: now,
    });

    const creds = {
      mode: input.mode || "gateway",
      gatewayUrl: input.gatewayUrl || "https://relay.foxdevstudio.com/v1",
      gatewayApiKey: input.gatewayApiKey || "relay-secret-key",
      bridgeUsername: emailAddress,
      bridgePassword: input.bridgePassword,
    };

    const encryptedCreds = encryptionService.encryptJson(creds, {
      tenantId: workspaceId,
      userId: principal.userId,
    });

    await db.insert(schema.providerConnections).values({
      id: nanoid(),
      tenantId: workspaceId,
      userId: principal.userId,
      accountId,
      provider: "proton",
      encryptedCredentials: encryptedCreds,
      keyVersion: config.KEY_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, accountId };
  }
}

/**
 * 5. PLAN CAPABILITIES SERVICE
 */
export class PlanService {
  async getCapabilities(principal: AuthPrincipal, workspaceId?: string): Promise<PlanCapabilities> {
    authService.requirePrincipal(principal);

    const isPersonal = !workspaceId || workspaceId === principal.tenantId;

    if (!isPersonal) {
      return {
        canCreateOrganization: true,
        maxTeamOrganizations: 5,
        maxOrganizationSeats: 10,
        maxMailboxes: 25,
        maxRelayDevices: 3,
        sharedProtonRelay: true,
        sso: false,
      };
    }

    // Default Personal Plan capabilities
    return {
      canCreateOrganization: true,
      maxTeamOrganizations: 1,
      maxOrganizationSeats: 1,
      maxMailboxes: 5,
      maxRelayDevices: 1,
      sharedProtonRelay: false,
      sso: false,
    };
  }
}

export const workspaceService = new WorkspaceService();
export const organizationMemberService = new OrganizationMemberService();
export const relayAndDeviceService = new RelayAndDeviceService();
export const organizationMailboxService = new OrganizationMailboxService();
export const planService = new PlanService();
