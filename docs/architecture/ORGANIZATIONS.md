# Organizations architecture

Team Organizations evolve Mailwarden's existing tenant isolation. A workspace is a tenant with `kind=personal|team`; there is no parallel organization security hierarchy.

## Shipped Platform foundation

- Existing `users.id` is the global identity.
- Existing `users.tenant_id` remains its Personal Workspace compatibility anchor.
- Existing tenants become active Personal Workspaces through migration defaults.
- `memberships` is the canonical workspace authorization source with `owner`, `admin`, and `member` roles.
- Sessions, OAuth codes/tokens, provider OAuth state, human sessions, and MCP credentials remain bound to exactly one selected workspace.
- Every token verification rechecks the current membership and workspace status.
- Team Organization create/list, active-workspace selection, invites, members, roles, removal, mailbox listing, quotas, relay devices, and audit events have Cloud APIs and D1 persistence.
- Existing private-beta invites remain a separate signup gate.

The persisted table named `organizations` still represents contact/sender intelligence. Team Organizations are rows in `tenants` with `kind=team`; no risky rename was performed.

## Identity compatibility

```text
Global user ID
├── legacy users.tenant_id ── Personal Workspace
├── membership ────────────── Personal Workspace
├── membership ────────────── FoxDevStudio
└── membership ────────────── Acme Corp
```

No existing ID or encrypted row moves. Provider credential AAD remains the original `tenantId + userId`, so existing ciphertext stays decryptable. `identity_email_claims` provides atomic normalized-email uniqueness for new identities.

The Personal Workspace is currently an immutable identity anchor: deleting it would trigger legacy foreign-key cascades. Mailwarden exposes no workspace-deletion API.

See [IDENTITY_AND_WORKSPACE_MIGRATION.md](./IDENTITY_AND_WORKSPACE_MIGRATION.md) for the complete inventory and migration decision.

## Authorization

Every workspace operation resolves:

```text
authenticated user → selected workspace → live membership → role → resource workspace
```

A caller-supplied workspace, mailbox, invite, or device ID is never sufficient. Removed memberships delete workspace sessions and revoke workspace refresh tokens; subsequent bearer verification also fails if a stale token remains.

Role policy:

- owner: ownership changes and all admin operations;
- admin: invitations, non-owner member management, mailboxes, and relay devices;
- member: organization mail features and relay health visibility;
- only owners may grant/remove owner;
- self-promotion is denied;
- an organization must retain an owner.

## Active workspace

`POST /api/workspaces/:workspaceId/select` validates membership and issues a new workspace-scoped token/cookie. Existing password login and legacy credentials default to the Personal Workspace. OAuth authorization may bind an optional `workspace_id`; refresh preserves that workspace.

The portal's `?ws=` value is presentation state only and is revalidated through the Platform service. MCP never aggregates workspaces implicitly.

## Organization invitations

`organization_invites` is separate from `beta_invites`. Organization tokens are random and hashed at rest, tenant/role bound, optionally email locked, expiring, revocable, and conditionally claimed once. A same-user retry can finish membership insertion after a transient failure; another identity cannot replay the token.

A valid Team invitation may continue new-user signup. Signup still creates the user's Personal Workspace, then adds the invited Team membership; it does not turn the organization invite into a private-beta invite.

## Mailboxes

A mailbox belongs to one workspace through `email_accounts.tenant_id`; `user_id` remains the connector/creator identity and encryption context. Team members can list Team mailboxes and provider lookup decrypts credentials using the original connector identity. Core email reads are Team workspace scoped.

Some higher-level attention/waiting/policy intelligence remains creator-user scoped and is not yet a complete shared-team view. Cross-workspace access remains denied.

## Plans

Capabilities are centralized in `@mailwarden/organizations` for Personal, Team, and Enterprise. Platform enforces organization, seat, mailbox, and relay limits server side. This is static entitlement policy; billing is not implemented.

## Still planned

- organization deletion and explicit ownership-transfer workflow;
- invite email delivery;
- complete shared-team semantics for all intelligence/policy surfaces;
- billing-backed entitlement assignment;
- advanced mailbox ACLs, SSO, and SCIM.
