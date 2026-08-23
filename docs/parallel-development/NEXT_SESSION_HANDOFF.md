# Next session handoff

Point in time: 2026-08-23, America/Sao_Paulo.

## What Mailwarden currently is

Mailwarden is a live Cloudflare Worker and D1 application providing Hono APIs, Solid SSR portal surfaces, personal tenant vaults, private-beta authentication, Gmail/Microsoft OAuth code, Proton gateway/connector code, MCP, mailbox sync/intelligence/policies, encrypted credentials, audit events, and human-confirmed sending. Production mailbox mutation remains disabled.

## What changed in this architecture session

- enabled Bun workspaces for `/apps/*` and `/packages/*`;
- made `apps/cloud/src/worker.ts` the Wrangler entrypoint while preserving the existing `/src` implementation;
- made `apps/bridge/src/gateway.ts` the Proton Gateway executable entrypoint;
- reserved `apps/desktop` without selecting a framework;
- moved the canonical Drizzle schema to `packages/db/src/schema.ts`;
- moved canonical SQL migrations from `src/db/migrations` to `/migrations`;
- updated Wrangler, Drizzle, and local migration paths;
- extracted shared contracts, permission scopes, organization guards, relay freshness, and Proton URL validation into real packages;
- added a focused workspace-foundation test;
- added Cloudflare/AlmaLinux/systemd/packaging infrastructure homes;
- created architecture, operations, ownership, integration, and model-specific kickoff documents.

The full Cloud source was not mass-moved because the checkout already contained large uncommitted portal/OAuth/provider changes. The application boundary is real at deployment/composition, and future Cloud slices can move incrementally with tests.

## Current repository structure

```text
apps/
  cloud/src/{worker.ts,index.ts}
  bridge/src/gateway.ts
  desktop/README.md
packages/
  contracts/ auth/ db/ organizations/ proton/ relay/
infra/
  cloudflare/ almalinux/ systemd/ packaging/
migrations/
src/                 # transitional Cloud implementation
tests/
docs/
  architecture/
  operations/
  parallel-development/
```

## Validation status

Pre-change baseline after the other agent's fix:

- `bun install --frozen-lockfile`: passed.
- `bun test`: 134 pass, 0 fail, 493 expectations, 24 files.
- `bun run typecheck`: failed with 27 existing errors: implicit-any callbacks in Gmail/attention plus 25 Solid SSR string-event-handler errors in untracked `src/ui/portal.tsx`.
- `bun run deploy:dry`: passed; 2821.18 KiB upload, 523.86 KiB gzip.

Final validation after the monorepo kickoff:

- `bun install --frozen-lockfile`: passed; 282 installs across 401 packages, no changes.
- `bun test`: 136 pass, 0 fail, 500 expectations, 25 files. One immediately prior run hit transient SQLite `database is locked`; no Bun process retained the file and the clean rerun passed.
- `bun run typecheck`: still fails with the same 27 pre-existing errors: implicit-any callbacks in `src/providers/gmail.ts` and `src/services/attention.ts`, plus 25 Solid SSR string-event-handler type errors in untracked `src/ui/portal.tsx`. No workspace/package type error was added.
- `bun run build`: passed through `apps/cloud/src/worker.ts`; 2856.74 KiB upload, 525.97 KiB gzip; D1 and all current vars were detected.
- isolated `bun run db:migrate`: migrations `0000` through `0005` applied successfully to a temporary SQLite database from the new `/migrations` path; the temporary database was removed.
- local Markdown link audit: 29 files checked, all local targets resolved.
- `git diff --check`: passed.

`bun run test:live` was not run because it is interactive and production-oriented. No production deployment or D1 migration was executed.

## Production status

Read-only `/health` verification during kickoff reported:

```text
status: ok
commit: 669fc7f
database: healthy
encryption: configured
mailboxMutationsEnabled: false
googleConfigured: true
microsoftConfigured: false
protonGateway: external-local-service
```

This proves the live deployment is healthy at commit `669fc7f`; it does not prove the dirty working-tree changes or monorepo kickoff are deployed. Current work is deployment-compatible by dry-run and **not deployed**.

Git remains on `main` at `669fc7f`, tracking `origin/main`. No commit was created. The working tree remains intentionally dirty with the pre-existing portal/provider/intelligence work and this monorepo kickoff.

## Important decisions

- One repository, several deployable applications, one lockfile, one contract language.
- Only Cloud accesses D1.
- Root Wrangler config remains the deployment control point.
- Personal tenants evolve into Personal Workspaces; no destructive recreation.
- Team Organizations are tenant/workspace kinds, not a second security hierarchy.
- Current identity is tenant-local and requires a deliberate migration before multi-workspace membership.
- Existing `organizations` table means contact intelligence, not Team workspace.
- Private-beta invites and organization invites are distinct.
- Bridge integrates official Proton Bridge; it does not recreate Proton cryptography.
- Cloudflare Tunnel is a product component.
- Device identity must replace shared permanent organization secrets.
- Desktop technology remains open.

## Unfinished and risky areas

1. Global identity/personal workspace migration is undecided; `users.tenant_id` is still required.
2. Membership-backed authorization and active workspace do not exist.
3. Team organization/member/invite/plan/relay APIs do not exist.
4. Current contact `organizations` naming collides with future Team Organization language.
5. Gateway implementation remains in transitional `/src` and uses one shared bearer key.
6. Current connector records are per-account, not independent organization relay devices.
7. Bridge daemon/CLI/provisioning/tunnel management/secret store/installer/repair/updater do not exist.
8. AlmaLinux is a Mailwarden reference path but not currently an officially supported Proton distribution.
9. Existing typecheck errors from the parallel portal/intelligence work remain to be resolved or baselined precisely.
10. The working tree contains substantial pre-existing uncommitted work; create a clean commit boundary before worktrees.

## Contract decisions still open

- global user identity and legacy user-ID mapping;
- workspace selection/binding in sessions, OAuth, and MCP;
- protocol versioning and wire serialization for relay timestamps/status;
- device provisioning and renewable credential shape;
- signed Cloud-to-relay request assertion;
- relay selection when multiple devices exist;
- mailbox `userId` meaning inside an organization workspace.

## Exact commands to resume

```bash
cd /home/thivieira/dev/tavtech/mailwarden
git status --short --branch
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
```

Do not run `bun run ship`, `wrangler deploy`, production migrations, or `test:live` by default.

## Recommended next actions

### GPT-5.6 Sol

Start with a read-only identity/foreign-key/encryption-context inventory. Write the global identity + Personal Workspace migration decision and security tests before adding a migration. This unblocks every other owner.

### Claude Opus 5

Characterize and test the existing gateway, then extract it from Cloud utility dependencies into Bridge Core without changing its HTTP behavior. Send Sol concrete provisioning/request-auth contract requirements.

### Gemini 3.7 Flash

Create contract-driven fixtures and information architecture for workspace selection, members, organization mailboxes, relay devices, and degraded/repair states. Do not persist or call nonexistent APIs; feed required fields/errors back to Sol and state-machine needs to Claude.

Recommended order: Sol identity/contracts first; Claude Bridge isolation can proceed in parallel without schema changes; Gemini fixtures/UX can proceed in parallel; integrate contracts → Platform API → Bridge → Product.
