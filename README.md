# Mailwarden

> Your email, managed through normal conversation.

Mailwarden connects Gmail, Microsoft 365, and Proton Mail to AI clients such as ChatGPT, Claude, Cursor, and custom MCP clients. It provides inbox status, attention queues, waiting states, search, drafting, and controlled actions while keeping tenant isolation, encrypted credentials, auditability, and human confirmation in code.

Mailwarden is live software, not a greenfield scaffold. Production runs on Cloudflare Workers and D1. Mailbox mutations remain disabled by default and currently in production:

```text
MAILBOX_MUTATIONS_ENABLED=false
```

## Repository

This is the canonical modular monorepo for the whole product:

```text
apps/
├── cloud/       Cloudflare Worker composition
├── bridge/      Proton Gateway executable; Bridge daemon/CLI planned
└── desktop/     Planned management shell; technology undecided

packages/
├── contracts/       cross-runtime workspace/mailbox/relay contracts
├── db/              canonical Drizzle D1 schema
├── auth/            shared permission scopes
├── organizations/   workspace membership/role foundation
├── proton/          Proton boundary types and validation
└── relay/           relay health foundation

infra/           Cloudflare, AlmaLinux, systemd, packaging
migrations/      canonical SQL migrations
src/             transitional Cloud implementation
tests/           Cloud/security/shared foundation tests
docs/            architecture, operations, parallel development
```

The deploy boundary has moved to `apps/cloud`; implementation under `/src` moves incrementally so production behavior and the existing dirty feature work remain reviewable.

## Applications

- **Cloud — SHIPPED:** Worker, portal, API, MCP, OAuth, intelligence, synchronization, policy, audit, approval, and D1 composition.
- **Bridge — PARTIAL:** existing Proton Gateway has an application entrypoint. Device provisioning, daemon, CLI, managed tunnel, installer, repair, and updates are planned.
- **Desktop — PLANNED:** no framework has been selected and no runtime ships yet.

Only Cloud accesses D1. Bridge and Desktop use authenticated Cloud protocols.

## Providers

- Gmail / Google Workspace: OAuth 2.0 and Google APIs.
- Microsoft 365 / Outlook: OAuth 2.0 and Microsoft Graph code path.
- Proton Mail: Mailwarden Cloud → Cloudflare Tunnel → Mailwarden Gateway → Proton Mail Bridge → Proton Mail.

Proton Bridge decrypts locally and exposes loopback IMAP/SMTP. Mailwarden's goal is to absorb that infrastructure complexity so the future user flow becomes: install Bridge, sign in, connect Proton, done.

## Safety invariants

- Queries and resources are scoped to authenticated tenant/user context.
- Provider credentials use tenant/user-bound AES-256-GCM envelope encryption.
- Sending requires human review of the exact hashed payload.
- Sends are idempotent.
- No permanent-delete operation reaches a provider.
- Dry-run keeps mailbox changes simulated until explicitly enabled.
- Private-beta signup invites are separate from future organization invites.

## Development

Requirements: Bun and the dependencies installed by the root lockfile.

```bash
bun install --frozen-lockfile
bun run db:migrate
bun run db:seed
bun run dev
```

Useful commands:

```bash
bun run dev:cloud       # local Bun Cloud runtime
bun run dev:bridge      # current Proton Gateway
bun test
bun run typecheck
bun run build           # Wrangler dry-run bundle; does not deploy
bun run mcp:stdio
```

`bun run test:live` targets a live deployment and is not part of the default gate.

## Cloudflare deployment

- Configuration: [`wrangler.jsonc`](./wrangler.jsonc)
- Worker entrypoint: [`apps/cloud/src/worker.ts`](./apps/cloud/src/worker.ts)
- D1 schema: [`packages/db/src/schema.ts`](./packages/db/src/schema.ts)
- D1 migrations: [`migrations/`](./migrations)
- Controlled ship workflow: [`scripts/ship.sh`](./scripts/ship.sh)

Run `bun run build` for a local deployment-compatible bundle. `bun run deploy` and `bun run ship` can change production and require deliberate authorization.

Current production endpoints:

- Worker: `https://mailwarden.corenet.workers.dev`
- MCP: `https://mailwarden.corenet.workers.dev/mcp`
- MCP JSON-RPC: `https://mailwarden.corenet.workers.dev/mcp/rpc`
- MCP SSE: `https://mailwarden.corenet.workers.dev/mcp/sse`
- Health: `https://mailwarden.corenet.workers.dev/health`

## Documentation

Start with:

- [Architecture overview](docs/architecture/OVERVIEW.md)
- [Modular monorepo](docs/architecture/MONOREPO.md)
- [Organizations](docs/architecture/ORGANIZATIONS.md)
- [Mailwarden Bridge](docs/architecture/MAILWARDEN_BRIDGE.md)
- [Proton relay](docs/architecture/PROTON_RELAY.md)
- [Security](docs/architecture/SECURITY.md)
- [MCP workspace direction](docs/architecture/MCP.md)
- [AlmaLinux operations](docs/operations/ALMALINUX.md)

For parallel development:

- [Three-owner split](docs/parallel-development/AGENT_SPLIT_PLAN.md)
- [Shared contracts](docs/parallel-development/SHARED_CONTRACTS.md)
- [Integration protocol](docs/parallel-development/INTEGRATION_PROTOCOL.md)
- [Next-session handoff](docs/parallel-development/NEXT_SESSION_HANDOFF.md)
