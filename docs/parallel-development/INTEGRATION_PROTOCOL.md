# Parallel branch integration protocol

This protocol is deliberately small: one developer, three strong agents, one repository.

## Before work

1. Start every worktree from the same integrated commit.
2. Read `OVERVIEW.md`, the domain architecture doc, `SHARED_CONTRACTS.md`, and `NEXT_SESSION_HANDOFF.md`.
3. Record owned and touched directories in `AGENT_HANDOFF.md`.
4. Run the baseline gate and preserve existing failures exactly.

## Ownership boundaries

- Platform changes schema/contracts/auth/API/MCP.
- Bridge changes relay runtime, Proton integration, infrastructure, and packaging.
- Product changes portal/desktop/UI/e2e.
- Cross-owner edits are allowed only when required for an end-to-end slice and are called out explicitly.

Avoid broad formatting, dependency upgrades, or file moves on parallel branches.

## Schema changes

1. Claude/Gemini describe the data need and access pattern; do not add a local database model.
2. Sol chooses the canonical schema and migration.
3. Migrations are append-only, ordered, safe for existing production rows, and tested locally.
4. Any encrypted-row identifier change includes a re-encryption/compatibility plan.
5. Bridge/Desktop receive API/contract changes, never D1 access.

## Contract changes

Use the procedure in `SHARED_CONTRACTS.md`. Merge stable additive contracts before implementation branches where possible. If a branch must prototype, keep types local to fixtures and replace them before integration.

## Required handoff

Every branch reports:

- exact files and behavior changed;
- contracts/endpoints/migrations affected;
- assumptions and unsupported cases;
- exact validation commands/results;
- production/deployment status;
- known integration conflicts and risky areas.

## Merge gate

At minimum:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
git status --short
```

`bun run build` is a Wrangler dry-run and must not deploy. Run live verification only when it is explicitly read-only or approved. Do not normalize a pre-existing failure into success; compare it with the recorded baseline.

Domain checks add to, not replace, the root gate. Bridge should test gateway/daemon/config; Product should test critical onboarding and degraded states; Platform should test migrations and cross-workspace attacks.

## Recommended merge order

1. additive contracts and migrations;
2. Platform producer/API behavior;
3. Bridge protocol consumer/runtime;
4. Product UI/API consumer;
5. integrated security and e2e checks;
6. documentation/handoff refresh.

Rebase each branch once immediately before integration. Resolve semantic conflicts with the domain owner; do not accept both competing models.

## Conflict resolution

- Schema/contracts: Sol decides after hearing the concrete Bridge/Product requirement.
- Bridge lifecycle/secrets/platform support: Claude decides within approved protocol/security boundaries.
- Interaction/accessibility/customer language: Gemini decides within authorization and protocol constraints.
- Product-wide safety or unclear ownership: preserve current production behavior and escalate to Sol for one final decision.

## Deployment

Merging is not deploying. Report separately:

- deployment-compatible: local tests and bundle pass;
- deployment-verified: approved deployment plus live verification completed;
- not deployed: default for feature branches.

Never let a branch agent run `bun run ship` or enable mailbox mutations without explicit instruction.
