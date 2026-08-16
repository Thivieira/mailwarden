export type PermissionScope =
  | "mail.read"
  | "mail.search"
  | "mail.modify"
  | "mail.archive"
  | "mail.draft"
  | "mail.send"
  | "signatures.read"
  | "signatures.manage"
  | "relationships.read"
  | "relationships.manage"
  | "profile.read"
  | "profile.manage"
  | "accounts.read"
  | "accounts.manage"
  | "admin.all";

export const ALL_SCOPES: PermissionScope[] = [
  "mail.read",
  "mail.search",
  "mail.modify",
  "mail.archive",
  "mail.draft",
  "mail.send",
  "signatures.read",
  "signatures.manage",
  "relationships.read",
  "relationships.manage",
  "profile.read",
  "profile.manage",
  "accounts.read",
  "accounts.manage",
];

export const READONLY_SCOPES: PermissionScope[] = [
  "mail.read",
  "mail.search",
  "signatures.read",
  "relationships.read",
  "profile.read",
  "accounts.read",
];

export interface AuthPrincipal {
  tenantId: string;
  userId: string;
  scopes: PermissionScope[];
  sessionId?: string;
  email?: string;
  displayName?: string;
  role?: "owner" | "admin" | "member";
}

export function hasScope(principal: AuthPrincipal, requiredScope: PermissionScope): boolean {
  if (principal.scopes.includes("admin.all")) return true;
  return principal.scopes.includes(requiredScope);
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
