# Three-owner development plan

Mailwarden remains one product and one repository. Use three large ownership domains, not dozens of micro-agents.

## Ownership map

| Owner | Domain | Canonical areas |
| --- | --- | --- |
| GPT-5.6 Sol | Mailwarden Platform | `packages/contracts`, `packages/db`, `packages/auth`, `packages/organizations`, Cloud API/MCP, migrations, security tests |
| Claude Opus 5 | Bridge and relay infrastructure | `apps/bridge`, `packages/proton`, `packages/relay`, `infra`, Bridge/relay tests |
| Gemini 3.7 Flash | Product experience | Cloud portal/UI, `apps/desktop`, future `packages/ui`, e2e tests |

### GPT-5.6 Sol mission

Own tenancy, global identity, workspaces, memberships, roles, organization invites, database migrations, plan capabilities, MCP workspace semantics, relay registration APIs, and final shared-contract decisions. Sol is the only final authority for D1 schema and migrations.

### Claude Opus 5 mission

Own everything between Mailwarden Cloud and Proton Mail: Bridge Core, gateway, Proton Bridge integration, Cloudflare Tunnel, device provisioning implementation, daemon/CLI, AlmaLinux/systemd, diagnostics, repair, health, packaging, service lifecycle, updates, and local credential handling.

### Gemini 3.7 Flash mission

Own the user-facing workspace, organization, mailbox, relay, device, and Bridge experience: workspace switcher, organization setup, members/invites/roles UX, Proton connection, relay health/repair, desktop shell, responsive behavior, accessibility, and customer-facing error states.

## Shared ownership rules

- Sol owns canonical schema, migrations, workspace semantics, and final `packages/contracts` review.
- Claude and Gemini propose contract changes through a focused commit and handoff; they do not create private competing types.
- An owner may make a small necessary cross-domain edit, but must list it in the handoff and request review from that domain owner.
- No agent may enable mailbox mutations, weaken human send approval, log secrets, or deploy production without explicit authorization.
- Private-beta invites and organization invites remain distinct.
- Bridge/Desktop never access D1 directly.

## Worktree workflow

From the canonical checkout:

```bash
git worktree add ../mailwarden-platform -b agent/platform
git worktree add ../mailwarden-bridge -b agent/bridge
git worktree add ../mailwarden-product -b agent/product
```

Suggested mapping:

```text
GPT-5.6 Sol       ../mailwarden-platform
Claude Opus 5     ../mailwarden-bridge
Gemini 3.7 Flash  ../mailwarden-product
```

Before creating worktrees, first commit or deliberately shelve the current dirty working tree. Do not create worktrees from a state that exists only as uncommitted files.

## Integration order

For the next phase:

1. Sol defines the identity/workspace migration and versioned relay/device contracts.
2. Claude builds Bridge against those reviewed contracts while Sol implements Cloud registration/heartbeat APIs.
3. Gemini builds portal flows against stable API fixtures/contracts, then integrates live endpoints.
4. Merge Platform contract/schema foundations first, Bridge second, Product third; rerun the full gate after each merge.

Product prototypes can begin earlier with fixtures, but must not invent a second persisted organization/device model.

## Repository handoff

Each branch keeps a concise `AGENT_HANDOFF.md` at its root or provides the same content in the final commit/PR:

```text
What changed
Contracts affected
Assumptions
New endpoints
Migration implications
Known gaps
How to test
Integration risks
```

Delete or archive the branch handoff after integration so it does not become stale architecture documentation.

## Cross-review

- Claude reviews Sol once, focusing on authorization boundaries, credential flow, failure cases, and whether Cloud assumptions are implementable on real hosts.
- Sol reviews Claude once, focusing on protocol scoping, device identity, secret/tunnel handling, and D1/API consistency.
- Gemini reviews the integrated product once, focusing on onboarding, accessibility, customer clarity, offline/degraded states, and repair paths.
- Sol performs one final architecture/integration gate. Fix findings; do not create endless review cycles.

## Must not be parallelized

Only Sol makes final decisions for:

- D1 schema and migration ordering;
- global user/personal workspace migration;
- membership/role authorization semantics;
- canonical cross-runtime contracts;
- MCP workspace binding.

Claude and Gemini should request these changes rather than merge incompatible persistence or protocol definitions.
