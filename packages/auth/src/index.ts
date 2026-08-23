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
  "mail.read", "mail.search", "mail.modify", "mail.archive", "mail.draft", "mail.send",
  "signatures.read", "signatures.manage", "relationships.read", "relationships.manage",
  "profile.read", "profile.manage", "accounts.read", "accounts.manage",
];

export const READONLY_SCOPES: PermissionScope[] = [
  "mail.read", "mail.search", "signatures.read", "relationships.read", "profile.read", "accounts.read",
];

export function hasScope(principal: { scopes: PermissionScope[] }, requiredScope: PermissionScope): boolean {
  return principal.scopes.includes("admin.all") || principal.scopes.includes(requiredScope);
}
