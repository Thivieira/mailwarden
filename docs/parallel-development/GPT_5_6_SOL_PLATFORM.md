# GPT-5.6 Sol kickoff: Mailwarden Platform

## Mission

Own Mailwarden's canonical identity, tenancy, organizations, authorization, D1 schema, migrations, shared contracts, plan capabilities, MCP workspace semantics, relay registration APIs, and final integration architecture.

## Owned directories

- `packages/contracts/`
- `packages/db/`
- `packages/auth/`
- `packages/organizations/`
- `migrations/`
- transitional Cloud auth/API/MCP/database code under `src/`
- future Cloud API/MCP directories under `apps/cloud/`
- `tests/security/` and Platform integration tests

## Non-owned directories

- `apps/bridge`, `packages/proton`, `packages/relay`, and operational packaging belong to Claude.
- portal presentation, desktop shell, UI components, and e2e product flows belong to Gemini.

Small coordinated edits are allowed; list them in the handoff.

## Current state

- Production is a Cloudflare Worker with D1, Hono routes, Solid SSR, OAuth, MCP, encrypted provider credentials, personal tenants, private-beta auth/invites, mailbox sync, and safety gates.
- `packages/db/src/schema.ts` is canonical; migrations are at `/migrations`.
- Existing rows use tenant-local users: `users.tenant_id` is required.
- `memberships` exist and personal owners receive one, but request authorization does not resolve membership.
- tokens bind one user and one tenant.
- the existing `organizations` table is contact intelligence, not Team workspaces.
- `beta_invites` are private-beta signup gates, not organization invites.
- shared workspace/relay contracts are foundations only.

## Dependencies and consumers

Claude needs reviewed device provisioning, relay registration, heartbeat, revocation, and Cloud request-auth contracts. Gemini needs organization/workspace API shapes, role/error semantics, and fixtures. Existing personal OAuth/MCP credentials must remain compatible.

## First milestone: identity/workspace decision

1. Inventory every `users.id`, `tenant_id`, membership, OAuth/session, credential, and audit dependency.
2. Choose the global identity versus tenant-local user migration model.
3. Specify Personal Workspace mapping for existing tenants without recreating IDs/data.
4. Resolve the contact-organization naming collision.
5. Define workspace-scoped authentication/session/MCP semantics.
6. Write migration and rollback strategy before changing production schema.

Do not implement Team UI or billing in this milestone.

## Second milestone: organization authorization

- membership-backed workspace resolver;
- owner/admin/member helpers;
- organization lifecycle and organization-invite service;
- active workspace API;
- mailbox workspace ownership checks;
- plan-capability resolver with static configuration initially;
- security tests for spoofing, roles, invite replay, mailbox guessing, and legacy personal credentials.

## Third milestone: relay platform API

- versioned RelayDevice/provisioning/heartbeat contracts;
- short-lived browser/device authorization;
- renewable scoped device credential representation;
- register/list/revoke/rotate device APIs;
- signed/scoped Cloud-to-relay request design;
- audit events and organization relay inheritance;
- no D1 access from Bridge.

## MCP milestone

Bind each MCP credential/session to exactly one resolved workspace. Preserve existing personal tokens through compatibility mapping. Do not add `tenantId` tool arguments as authorization. Add cross-workspace denial tests for all read/search/status and mailbox-action paths.

## Security constraints

- `MAILBOX_MUTATIONS_ENABLED=false` remains unchanged.
- Sending retains exact-payload human approval.
- Existing encrypted credentials are bound to tenant/user IDs.
- Private-beta and organization invites remain separate.
- No credential/token values in audit/log/error responses.
- Migrations are append-only and production-safe.

## Definition of done

- architecture decision and migration plan are documented;
- schema/contracts have one canonical definition;
- existing personal users/OAuth/mailboxes/MCP/tests remain compatible;
- workspace authorization derives from authenticated membership;
- Platform tests cover role and cross-workspace attacks;
- Claude/Gemini have stable versioned contracts/fixtures;
- root test/typecheck/build results are reported exactly;
- no production deploy unless explicitly authorized.

## Handoff format

Report: what changed; contracts; endpoints; migrations/backfill/rollback; legacy compatibility; security tests; exact commands/results; assumptions/gaps; Bridge/Product requests; integration risks.
