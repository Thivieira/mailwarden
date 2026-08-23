# Organizations architecture

Organizations are a target domain built by evolving existing tenant isolation, not a second security hierarchy layered beside it.

## Status inventory

### Already implemented

- `tenants` isolate stored mail, credentials, policies, drafts, approvals, and audit events.
- `users` carry `tenant_id`, email, display name, and a coarse owner/admin/member role.
- `memberships` connect a user and tenant and are seeded with an owner membership when a personal vault is created.
- Authentication tokens carry one `tenantId` and one `userId`.
- Mailbox and service queries generally constrain both values.
- Private-beta signup invites exist as `beta_invites` in migration `0005`.

### Partially implemented

- A personal signup creates one tenant described in UI as a vault. This can become the user's Personal Workspace without recreating mailboxes or credentials.
- Membership data exists, but request authorization does not resolve active membership/role from it.
- Shared contracts define `Workspace`, `Organization`, `Membership`, `OrganizationInvite`, `WorkspaceContext`, and `PlanCapabilities`.
- `packages/organizations` validates workspace context and role ordering, but Cloud routes do not use it yet.
- A schema table named `organizations` exists, but it represents organizations associated with senders/relationships inside a user's email intelligence. It is not a Team Organization/workspace table. Renaming or disambiguating it requires a deliberate migration.

### Planned

- One global user identity belonging to a Personal Workspace and zero or more Team Organizations.
- Active workspace selection for portal, API, and MCP.
- Organization lifecycle, member management, role changes, and organization-specific invites.
- Membership-backed authorization helpers such as `requireTenantMembership`, `requireTenantAdmin`, and `requireTenantOwner`.
- Organization-owned mailboxes, relay inheritance, plan capabilities, seats, quotas, and audit surfaces.

## Target model

```text
User identity
├── Membership (owner) ── Personal Workspace (existing personal tenant)
├── Membership (admin) ── FoxDevStudio (organization tenant)
└── Membership (member) ─ Acme Corp (organization tenant)
```

A Team Organization is a tenant/workspace kind. It must not introduce an unrelated `organization_id` authorization tree beside `tenant_id`.

## Migration constraint

The current `users.tenant_id NOT NULL` model treats a user row as tenant-local. Multi-workspace membership therefore cannot be completed by adding UI alone. GPT-5.6 Sol must choose and migrate one canonical identity model, likely separating global identity from tenant membership while preserving existing user IDs or providing an explicit mapping.

Before any schema change, inventory production counts and foreign-key usage for:

- users, tenants, memberships, sessions, OAuth codes/tokens, credentials;
- every table carrying `tenant_id` and `user_id`;
- private-beta owner bootstrap behavior;
- audit references and encrypted provider-credential AAD.

Do not change encryption context IDs casually: existing ciphertext is bound to current tenant/user values.

## Personal Workspace

Every existing normal user already has a personal tenant and must retain it. The migration should add workspace kind/metadata or an equivalent safe mapping; it must not recreate tenants, OAuth connections, mailbox IDs, indexed messages, MCP credentials, sessions, policies, sync cursors, or audit history.

Personal-only users should continue to see the existing simple portal. Organization navigation should appear only when useful.

## Team Organization

Initial roles remain `owner`, `admin`, and `member`:

- owner: destructive organization lifecycle and ownership transfer;
- admin: members, invites, mailboxes, and relay administration within policy;
- member: organization mail features and inherited relay use.

No finer enterprise RBAC is planned for the first organization release.

## Active workspace and authorization

Every workspace-scoped operation must derive context from:

```text
authenticated user + selected workspace + verified membership + role
```

The selected workspace may be encoded in a scoped token/session or resolved from an explicit workspace selector, but a caller-supplied tenant ID is never sufficient. Resource IDs are still checked against the resolved workspace.

MCP should default safely to the token's single resolved workspace. Cross-workspace aggregation is a separate explicitly designed feature, not an implicit search behavior.

## Mailbox ownership

A mailbox belongs to exactly one workspace. Current rows already carry `tenant_id` and `user_id`; the future migration must define whether `user_id` is the connector/owner, the permitted principal, or both. Do not add a parallel mailbox organization ACL until the simple workspace ownership model is insufficient.

## Invites: two different products

- **SHIPPED:** `beta_invites` gates creation of a new private-beta user/personal vault.
- **PLANNED:** organization invites add an existing or new identity to a Team Organization with a role.

They require separate tables, services, routes, tokens, expiry/replay rules, audit actions, and UI language.

## Relay inheritance

**PLANNED:** organization administrators register relay devices/configuration once. Members then connect their own Proton mailbox using that inherited relay without seeing tunnel hostnames, ports, gateway secrets, systemd, or cloudflared. Device identity must replace the current permanent organization-wide bearer-secret concept before this is considered production-ready.

## Plan capabilities

Capabilities belong in one Platform-owned resolver, not route conditionals. The shared contract establishes the boundary, but Personal/Team/Enterprise billing and enforcement are not implemented.
