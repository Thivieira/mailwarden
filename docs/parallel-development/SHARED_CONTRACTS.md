# Shared contracts

Canonical cross-runtime TypeScript contracts live in `packages/contracts/src/index.ts` and are exported as `@mailwarden/contracts`.

## What belongs there

A contract belongs in the package when two separately deployable surfaces must agree on serialized meaning—for example Cloud and Bridge, Cloud and Desktop, or API fixtures and portal.

Current foundations:

| Contract | Status | Purpose |
| --- | --- | --- |
| `Workspace`, `Organization` | FOUNDATION | Personal/Team workspace identity |
| `Membership`, `MembershipRole` | FOUNDATION | User-to-workspace role |
| `OrganizationInvite` | PLANNED CONTRACT | Team invitation; distinct from private-beta invites |
| `WorkspaceContext` | FOUNDATION | Explicit user/workspace/membership authorization context |
| `PlanCapabilities` | PLANNED CONTRACT | Centralized entitlement output; billing not implemented |
| `Mailbox`, provider/status types | PARTIAL | Cross-surface mailbox summary; existing internal account model is richer |
| `RelayDevice`, `RelayStatus`, `RelayCapabilities` | PLANNED CONTRACT | Independently registered organization relay |
| `RelayHeartbeat` | PLANNED CONTRACT | Cloud-visible relay health |
| relay provisioning request/response | PLANNED CONTRACT | Device bootstrap boundary; protocol not implemented |
| `ApiError` | FOUNDATION | Stable cross-client error envelope |

Type presence does not mean a feature is shipped. Architecture documents and endpoint implementation determine runtime status.

## What does not belong there

- Drizzle row types and D1 implementation details;
- Cloud-only service inputs;
- portal component props;
- raw Proton Bridge credentials or tunnel tokens;
- every internal MCP tool schema;
- speculative desktop framework APIs.

Database schema lives in `packages/db`; shared permission scopes live in `packages/auth`; domain behavior belongs in its owning package.

## Naming collision

The current Cloud domain has an internal `Organization` type/table for organizations inferred or recorded in email relationships. It is not a Team Organization workspace. New cross-runtime code must import Team workspace contracts from `@mailwarden/contracts`. Sol must resolve the persisted naming collision in a reviewed migration before organization APIs ship.

## Change procedure

1. Owner writes the consumer need and wire-level example in the branch handoff.
2. Add or change the smallest canonical type; prefer additive optional fields while clients are version-skewed.
3. Update both producer and consumer or add an explicit compatibility adapter.
4. Add one serialization/behavior check for non-trivial semantics.
5. Update this status table and any affected protocol docs.
6. Sol reviews and integrates the contract change before independent branches depend on it.

Breaking changes require a versioning/migration plan. Renaming a TypeScript field is breaking when it crosses HTTP, persisted config, or device protocol boundaries even if compilation succeeds on one branch.

## Security requirements

Contracts identify secrets by purpose but must not encourage their inclusion in logs or general DTOs. Provisioning tokens are short-lived. Renewable device credentials need a separate secure response/storage path. Workspace IDs and device IDs are identifiers, never authorization by themselves.
