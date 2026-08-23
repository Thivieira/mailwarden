# Shared contracts

Canonical cross-runtime TypeScript contracts live in `packages/contracts/src/index.ts` and are exported as `@mailwarden/contracts`.

## What belongs there

A contract belongs in the package when two separately deployable surfaces must agree on serialized meaning—for example Cloud and Bridge, Cloud and Desktop, or API fixtures and portal.

Current foundations:

| Contract | Status | Purpose |
| --- | --- | --- |
| `Workspace`, `Organization` | SHIPPED | Personal/Team workspace identity |
| `Membership`, `MembershipRole` | SHIPPED | User-to-workspace authorization role |
| `OrganizationInvite` | SHIPPED | Team invitation; distinct from private-beta invites |
| `WorkspaceContext` | SHIPPED | Explicit user/workspace/membership authorization context |
| `PlanCapabilities` | SHIPPED | Centralized static entitlement output; billing not implemented |
| `Mailbox`, provider/status types | PARTIAL | Cross-surface mailbox summary; existing internal account model is richer |
| `RelayDevice`, `RelayStatus`, `RelayCapabilities` | SHIPPED | Independently registered organization relay and its latest optional health snapshot |
| `BridgeHealth`, `RelayHeartbeatResponse` | SHIPPED | Canonical Cloud/Bridge health and revocation response |
| relay provisioning and device credential contracts | SHIPPED | Versioned device bootstrap, renewal, and revocation boundary |
| tunnel, diagnostics, and repair contracts | PARTIAL | Implemented by Bridge; managed Cloud tunnel allocation is not shipped |
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

The current Cloud domain has an internal `organizations` table for contact intelligence. It is not a Team Organization workspace. Team Organizations ship as `tenants.kind=team`, and cross-runtime code imports their contracts from `@mailwarden/contracts`. The intelligence table was deliberately not renamed because a cosmetic production migration would add risk without changing the security model.

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
