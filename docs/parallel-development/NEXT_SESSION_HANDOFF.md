# Next session handoff

Point in time: 2026-08-23, America/Sao_Paulo. The implementation described here is locally validated and **not deployed or migrated in production**.

## What Mailwarden is now

Mailwarden is one Bun monorepo with three runtime surfaces:

- Cloudflare Worker + D1: portal, APIs, OAuth, MCP, mail intelligence, policy, audit, and human-approved actions;
- Bridge: Core, daemon, CLI, local API, Proton Gateway, Proton discovery, device identity, health/diagnostics, secret storage, and Cloudflare Tunnel process management;
- Desktop: a loopback Bun companion prototype consuming Bridge and shared UI contracts, not a packaged native application.

Only Cloud accesses D1. `apps/cloud/src/worker.ts` is the Wrangler entrypoint; the Cloud implementation remains incrementally under `/src`. Mailbox mutation remains disabled by default and in the current Wrangler configuration.

## What changed

### Platform

- `users.id` is the global identity; `users.tenant_id` remains the unchanged Personal Workspace and encryption compatibility anchor.
- Team Organizations are tenants with `kind=team`; the existing contact-intelligence `organizations` table is untouched.
- Memberships are the live authorization source. JWT, OAuth, human-session, stream-ticket, provider callback, and MCP use revalidate the selected workspace membership.
- Active-workspace selection issues a new workspace-scoped token; legacy login defaults to Personal.
- Organization create/list, invitations, acceptance, member roles/removal, mailboxes, quotas, relay devices, and audit events are D1-backed.
- Private-beta invites and Team invitations remain separate.
- MCP exposes active/list workspace tools and never aggregates workspaces implicitly.
- The versioned `/api/bridge/v1/*` API now matches Bridge's HTTP client for provisioning, polling, heartbeat, credential renewal, revocation response, and honest no-tunnel behavior.

### Bridge and Product

- Bridge Core, daemon, CLI, local API, Proton discovery/gateway, device credential handling, diagnostics, repairs, tunnel lifecycle, systemd, and AlmaLinux installer are implemented.
- The portal has Personal/Team workspace, member/invite, organization mailbox, relay/device, plan/security, and human-readable diagnostics surfaces.
- `@mailwarden/ui` and a Desktop companion prototype exist.
- Portal organization/device services now call canonical Platform persistence rather than process-local fake stores. Repair reports unavailable until a real Bridge control path exists.

## Current repository structure

```text
apps/
  cloud/src/{worker.ts,index.ts}
  bridge/src/{cli.ts,daemon.ts,gateway.ts,core/}
  desktop/src/
packages/
  auth/ contracts/ db/ organizations/ proton/ relay/ ui/
infra/
  almalinux/ cloudflare/ packaging/ systemd/
migrations/
  0000 ... 0007
src/                 # transitional Cloud implementation
tests/               # Cloud, Platform security, Product, Bridge, integration
docs/
  architecture/ operations/ parallel-development/
```

## Schema and migration state

- `0006_platform_workspaces_and_relays.sql` adds tenant kind/status/plan, backfills Personal owner memberships, and creates organization invitation, relay device, provisioning session, and relay credential tables.
- `0007_global_identity_email_claims.sql` adds and backfills one normalized-email claim per global identity. Claims are reserved before user creation and explicitly removed on rollback.
- No existing tenant, user, mailbox, provider account, ciphertext, OAuth, session, message, or audit ID moves.
- Provider credential AAD remains the original `tenantId + userId`.

Before a remote migration, query for duplicate normalized existing emails and missing Personal owner memberships. The `INSERT OR IGNORE` backfill is non-destructive, but duplicate legacy identities require an explicit operator decision.

## Validation status

Current local validation:

- `bun test`: 227 passing, 0 failing, 732 expectations, 30 files.
- `bun run typecheck`: passing with 0 TypeScript errors.
- `bun run build`: passing through UI/MCP App generation and Wrangler dry-run; D1 and current variables resolve.
- `MAILBOX_MUTATIONS_ENABLED=false` is present in the dry-run binding output.
- `bun run db:migrate`: migrations `0000` through `0007` applied to the local development database.
- `tests/platform_security.test.ts` also applies the complete migration sequence to a new temporary SQLite database.

`bun run test:live`, production deployment, and remote D1 migrations were not run. The last health snapshot recorded during the earlier kickoff was commit `669fc7f`; treat it as historical, not proof that this branch is live.

## Important decisions

- One repository, one lockfile, several deployable applications, one canonical contract package.
- Only Cloud owns D1 and migrations.
- Existing tenant and user IDs remain stable to preserve encrypted credentials and foreign keys.
- Workspace IDs select context; only a live membership grants access.
- Tokens resolve one workspace, never a union of all memberships.
- Organization invite tokens, relay device codes, and device secrets are hashed at rest; gateway secrets are envelope-encrypted.
- One-time device credential delivery is deliberate. If delivery is lost, reprovision instead of recovering plaintext.
- The legacy Proton Gateway bearer remains a compatibility mode; registered devices have independent gateway secrets and the gateway supports a signed v1 request mode.
- Desktop native technology remains open.

## Remaining gaps and risks

1. Run an actual Bridge `HttpCloudClient` against a local HTTP Cloud server and then a non-production Worker; current coverage verifies the exact Hono wire routes in-process.
2. Add public device-start rate limiting and expired provisioning cleanup before exposing the flow broadly.
3. Implement managed Cloudflare Tunnel allocation and persist only device-scoped tunnel credentials; the v1 tunnel endpoint currently returns authenticated `404`.
4. Adopt `@mailwarden/relay` signed gateway requests in Cloud when registered-device mailbox routing lands.
5. Complete shared-team semantics for attention, waiting, and policy intelligence; core mail/provider access is already workspace-scoped.
6. Add organization invitation email delivery, explicit ownership transfer, and organization deletion policy.
7. Replace static plan assignment with billing entitlements only when billing is implemented.
8. Package/sign Bridge and Desktop, add non-Linux service and secret-store adapters, and prove update rollback.
9. Review the broad `feat(product)` commit carefully: the agents shared one physical checkout, so it captured the P0 monorepo and early Platform files before later owner-specific commits.

## Git and integration state

The shared checkout is on `agent/product`. Existing integrated commits include:

- `feat(product): implement organizations UX, portal dashboard, @mailwarden/ui & desktop companion` (also contains the P0 monorepo and early Platform foundation because the checkout was shared);
- `feat(bridge): introduce Bridge Core, daemon, and CLI`;
- `feat(infra): add managed systemd service and AlmaLinux Bridge installer`;
- the subsequent Platform commit containing final authorization, identity claims, Bridge v1 integration, tests, and handoff.

Do not rewrite those commits merely to improve ownership aesthetics. Use separate worktrees for the next parallel phase.

## Exact commands to resume

```bash
cd /home/thivieira/dev/tavtech/mailwarden
git status --short --branch
bun install --frozen-lockfile
bun run db:migrate
bun test
bun run typecheck
bun run build
git diff --check
```

Do not run `bun run ship`, `wrangler deploy`, remote migrations, or `bun run test:live` by default.

## Recommended next actions

### GPT-5.6 Sol — Platform

Run duplicate-email/membership preflight against an exported production schema snapshot, add provisioning abuse controls/cleanup, then implement signed Cloud-to-gateway routing against registered relay devices. Preserve the legacy gateway path until a staged Bridge rollout succeeds.

### Claude Opus 5 — Bridge

Point `HttpCloudClient` at a local Cloud server and complete the browser device-authorization loop. Report any wire mismatch in `packages/contracts`, then test revoked credential erasure and renewal end to end. Do not depend on a tunnel credential until Platform allocation exists.

### Gemini 3.7 Flash — Product

Replace query-only workspace presentation with the workspace-selection endpoint wherever a persistent context change is intended, carry `organizationInviteToken` through the authenticated signup flow, and connect device authorization UI to the real user-code endpoint. Keep repair controls disabled until Bridge exposes an authenticated remote control path.

Integration order: Platform migration/preflight → Cloud/Bridge v1 interoperability → portal authorization/onboarding → managed tunnel → staged non-production deployment. Sol performs the final schema/contract/security review; Claude reviews failure/secrets behavior; Gemini reviews the integrated customer path.
