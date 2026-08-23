import { getPlanCapabilities } from "@mailwarden/organizations";
import type {
  MembershipRole,
  Organization,
  OrganizationInvite,
  PlanCapabilities,
  RelayDevice,
  RelayStatus,
  Workspace,
  WorkspaceContext,
} from "@mailwarden/contracts";
import { mapRawErrorToDiagnostic, type DiagnosticItem } from "@mailwarden/ui";
import type { AuthPrincipal } from "../types/auth";
import { ValidationError } from "../utils/errors";
import { organizationService } from "./organizations";
import { relayDeviceService } from "./relay-devices";

export class WorkspaceService {
  async listWorkspaces(principal: AuthPrincipal): Promise<Workspace[]> {
    const contexts = await organizationService.listWorkspaces(principal);
    return contexts.map((context) => ({
      ...context.workspace,
      name: context.workspace.kind === "personal" ? "Personal Workspace" : context.workspace.name,
    }));
  }

  async getActiveWorkspace(principal: AuthPrincipal, requestedWorkspaceId?: string): Promise<WorkspaceContext> {
    return organizationService.requireWorkspaceMembership(principal, requestedWorkspaceId || principal.tenantId);
  }

  async createOrganization(principal: AuthPrincipal, input: { name: string; slug?: string }) {
    const context = await organizationService.createOrganization(principal, input);
    return { organization: context.workspace as Organization, context };
  }
}

export class OrganizationMemberService {
  async listMembers(principal: AuthPrincipal, organizationId: string) {
    const rows = await organizationService.listMembers(principal, organizationId);
    return rows.map((row: any) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      role: row.role as MembershipRole,
      joinedAt: row.createdAt,
      isSelf: row.userId === principal.userId,
    }));
  }

  async inviteMember(
    principal: AuthPrincipal,
    organizationId: string,
    input: { email: string; role?: Exclude<MembershipRole, "owner"> }
  ): Promise<OrganizationInvite & { inviteUrl: string }> {
    const created = await organizationService.createInvite(principal, organizationId, input);
    return { ...created.invite, inviteUrl: created.inviteUrl };
  }

  async updateMemberRole(principal: AuthPrincipal, organizationId: string, userId: string, role: MembershipRole) {
    await organizationService.changeMemberRole(principal, organizationId, userId, role);
  }

  async removeMember(principal: AuthPrincipal, organizationId: string, userId: string) {
    await organizationService.removeMember(principal, organizationId, userId);
  }

  async listPendingInvites(principal: AuthPrincipal, organizationId: string): Promise<OrganizationInvite[]> {
    const now = new Date().toISOString();
    return (await organizationService.listInvites(principal, organizationId)).filter(
      (invite: OrganizationInvite) => !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > now
    );
  }

  async revokeInvite(principal: AuthPrincipal, organizationId: string, inviteId: string) {
    await organizationService.revokeInvite(principal, organizationId, inviteId);
  }
}

export class RelayAndDeviceService {
  async listRelayDevices(principal: AuthPrincipal, organizationId: string): Promise<RelayDevice[]> {
    return relayDeviceService.listDevices(principal, organizationId);
  }

  async getRelayStatus(principal: AuthPrincipal, organizationId: string) {
    const devices = await this.listRelayDevices(principal, organizationId);
    const active = devices.filter((device) => !device.revokedAt);
    const status: RelayStatus = active.some((device) => device.status === "online")
      ? "online"
      : active.some((device) => device.status === "degraded" || device.status === "needs_attention")
        ? "degraded"
        : "offline";
    return {
      status,
      connectedAccountsCount: active.reduce((total, device) => total + (device.health?.accounts.connected || 0), 0),
      activeDevicesCount: active.filter((device) => device.status === "online").length,
      lastSeenAt: active.map((device) => device.lastSeenAt).filter(Boolean).sort().pop(),
    };
  }

  async revokeDevice(principal: AuthPrincipal, organizationId: string, deviceId: string) {
    await relayDeviceService.revokeDevice(principal, organizationId, deviceId);
  }

  async requestProvisioning(_principal?: AuthPrincipal, _organizationId?: string, _input?: unknown): Promise<never> {
    throw new ValidationError("Bridge provisioning starts on the device; use /api/relay/provisioning/start");
  }

  async approveProvisioning(_principal?: AuthPrincipal, _organizationId?: string, _token?: string): Promise<never> {
    throw new ValidationError("Approve the Bridge user code through /api/relay/provisioning/authorize");
  }

  async getDiagnostics(_principal: AuthPrincipal, _organizationId: string, rawError?: string): Promise<DiagnosticItem> {
    return mapRawErrorToDiagnostic(rawError);
  }

  async executeSafeRepair(_principal?: AuthPrincipal, _organizationId?: string, _actionId?: string, _deviceId?: string) {
    return { success: false, message: "Repair requires a connected Mailwarden Bridge runtime." };
  }
}

export class OrganizationMailboxService {
  listMailboxes(principal: AuthPrincipal, workspaceId: string) {
    return organizationService.listMailboxes(principal, workspaceId);
  }
}

export class PlanService {
  async getCapabilities(principal: AuthPrincipal, workspaceId = principal.tenantId): Promise<PlanCapabilities> {
    const context = await organizationService.requireWorkspaceMembership(principal, workspaceId);
    return getPlanCapabilities(context.workspace.plan);
  }
}

export const workspaceService = new WorkspaceService();
export const organizationMemberService = new OrganizationMemberService();
export const relayAndDeviceService = new RelayAndDeviceService();
export const organizationMailboxService = new OrganizationMailboxService();
export const planService = new PlanService();
