# Next session handoff

## Ownership

The three-agent parallel phase is over. **Claude Opus 5 is the principal
implementation owner and final integrator** for the whole monorepo.

| Agent | Role now |
| --- | --- |
| Claude Opus 5 | Principal owner: Platform, Bridge, Product, infrastructure, integration |
| GPT-5.6 Sol | Optional specialist for Platform, security, and migration review |
| Gemini 3.7 Flash | Optional specialist for UI and product refinement |

Future work does not require three concurrent owners unless parallelism is
deliberately reintroduced. The per-agent kickoff and handoff documents in this
directory are kept as historical records; they describe the streams as they were
before consolidation, not the current system.

**Start here instead:** [`docs/architecture/CONSOLIDATED_STATE.md`](../architecture/CONSOLIDATED_STATE.md).

## State at consolidation

- All three streams are merged on one linear history; there are no parallel branches.
- `bun test`, `bun run typecheck`, `bun run build`, and the migration run all pass.
- Cross-system integration tests cover Platform ↔ Bridge, Cloud ↔ Bridge control,
  Bridge ↔ Desktop, and Platform ↔ Portal.
- Bridge was verified against real Proton Mail Bridge 3.25.0 and real cloudflared
  2026.7.3 on the reference host.
- Production had not been migrated or deployed at the time of consolidation; see
  the release notes and `CHANGELOG.md` for what shipped afterwards.

## Priorities from here

1. Managed Cloudflare Tunnel allocation on the Cloud side (device side is done).
2. Signed Cloud→gateway *mail* requests (the control plane already signs).
3. Staging migration and integration verification for migrations 0006 and 0007.
4. Team-wide attention/waiting/policy semantics for shared mailboxes.
5. Invite email delivery and organization ownership transfer.
6. Quota concurrency hardening.
7. Bridge/Desktop packaging and signing; macOS and Windows adapters.
8. Automatic updates — only after signing, rollback, and interrupted-upgrade recovery.

## Rules that still hold

- D1 migrations are append-only and must preserve existing tenant ids, encrypted
  credential AAD, and Personal Workspace data.
- A workspace id never authorizes by itself; only a live membership does.
- Bridge never touches D1 and never holds an organization-wide secret.
- Mailbox mutations stay disabled (`MAILBOX_MUTATIONS_ENABLED=false`) until
  explicitly enabled, and sending stays human-confirmed.
