import {
  ALL_SCOPES,
  READONLY_SCOPES,
  hasScope as hasGrantedScope,
  type PermissionScope,
} from "@mailwarden/auth";
import type { MembershipRole } from "@mailwarden/contracts";

export { ALL_SCOPES, READONLY_SCOPES, type PermissionScope } from "@mailwarden/auth";

export interface AuthPrincipal {
  /** Canonical active workspace. `tenantId` is retained for transitional Cloud code. */
  workspaceId?: string;
  tenantId: string;
  userId: string;
  personalWorkspaceId?: string;
  scopes: PermissionScope[];
  sessionId?: string;
  email?: string;
  displayName?: string;
  role?: MembershipRole;
}

export function hasScope(principal: AuthPrincipal, requiredScope: PermissionScope): boolean {
  return hasGrantedScope(principal, requiredScope);
}

export function requireScope(principal: AuthPrincipal, requiredScope: PermissionScope): void {
  if (!hasScope(principal, requiredScope)) {
    const { AuthorizationError } = require("../utils/errors");
    throw new AuthorizationError(
      `Permission denied: scope '${requiredScope}' is required for this operation`,
      [requiredScope]
    );
  }
}
