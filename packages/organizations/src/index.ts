import type { MembershipRole, PlanCapabilities, PlanId, WorkspaceContext } from "@mailwarden/contracts";

const ROLE_RANK: Record<MembershipRole, number> = { member: 0, admin: 1, owner: 2 };

export function requireWorkspaceMembership(context: WorkspaceContext, workspaceId: string): WorkspaceContext {
  if (
    context.workspace.id !== workspaceId ||
    context.membership.workspaceId !== workspaceId ||
    context.membership.userId !== context.userId
  ) {
    throw new Error("Authenticated user is not a member of the requested workspace");
  }
  return context;
}

export function hasWorkspaceRole(context: WorkspaceContext, requiredRole: MembershipRole): boolean {
  return ROLE_RANK[context.membership.role] >= ROLE_RANK[requiredRole];
}

export function roleAtLeast(role: MembershipRole, requiredRole: MembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole];
}

const PLAN_CAPABILITIES: Record<PlanId, PlanCapabilities> = {
  personal: {
    canCreateOrganization: true,
    maxTeamOrganizations: 1,
    maxOrganizationSeats: 5,
    maxMailboxes: 3,
    maxRelayDevices: 0,
    sharedProtonRelay: false,
    sso: false,
  },
  team: {
    canCreateOrganization: true,
    maxTeamOrganizations: 3,
    maxOrganizationSeats: 25,
    maxMailboxes: 100,
    maxRelayDevices: 3,
    sharedProtonRelay: true,
    sso: false,
  },
  enterprise: {
    canCreateOrganization: true,
    maxTeamOrganizations: 25,
    maxOrganizationSeats: 1_000,
    maxMailboxes: 10_000,
    maxRelayDevices: 25,
    sharedProtonRelay: true,
    sso: true,
  },
};

export function getPlanCapabilities(plan: PlanId): PlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}
