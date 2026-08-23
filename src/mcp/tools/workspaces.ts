import { z } from "zod";
import type { AuthPrincipal, PermissionScope } from "../../types/auth";
import { organizationService } from "../../services/organizations";

export const workspaceTools = [
  {
    name: "get_active_workspace",
    description: "Return the one workspace this Mailwarden session is scoped to.",
    parameters: z.object({}),
    requiredScopes: ["mail.read"] as PermissionScope[],
    handler: async (principal: AuthPrincipal) =>
      organizationService.requireWorkspaceMembership(principal, principal.tenantId),
  },
  {
    name: "list_workspaces",
    description: "List workspaces available to this identity without combining their email.",
    parameters: z.object({}),
    requiredScopes: ["mail.read"] as PermissionScope[],
    handler: async (principal: AuthPrincipal) => organizationService.listWorkspaces(principal),
  },
];
