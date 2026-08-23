# Gemini 3.7 Flash kickoff: Mailwarden product experience

## Mission

Own the user-facing Personal/Organization and Bridge experience, hiding relay infrastructure behind clear onboarding, health, repair, and workspace interactions.

## Owned directories

- current portal/UI code under `src/ui` and `src/http/routes/portal.ts` during transition
- future `apps/cloud/portal/`
- `apps/desktop/`
- future `packages/ui/` only when web/desktop genuinely share stable primitives
- `tests/e2e/` and product-flow tests

## Non-owned directories

- schema, migrations, auth semantics, workspace/relay contracts, and Platform APIs belong to Sol.
- Bridge daemon, Proton/tunnel/service lifecycle, packaging, and diagnostics implementation belong to Claude.

Use fixtures for missing endpoints; do not persist a competing organization/device model.

## Current state

- Solid SSR pages and a self-service portal are in the current working source.
- Gmail/Microsoft OAuth and Proton connection routes exist; production configuration may differ by provider.
- users currently resolve one personal tenant; no active workspace switcher or Team Organization API exists.
- private-beta signup invites exist and must not be labeled organization invites.
- `apps/desktop` has no technology/runtime decision.
- relay health is limited to current per-account connector status; full RelayDevice states are planned.

## Required Platform and Bridge inputs

From Sol:

- workspace list/select/current APIs;
- organization/member/invite/role API fixtures;
- mailbox ownership and capability/error contracts;
- relay device list/provision/revoke contract;
- explicit authorization errors safe for customers.

From Claude:

- Bridge onboarding state machine;
- install/sign-in/provision/connect states;
- health/degraded/offline reasons;
- diagnostics and repair actions;
- platform support and permission requirements;
- desktop-to-daemon boundary.

## Milestone 1: information architecture and fixtures

Design a simple experience where personal-only users barely notice organizations. Define responsive/accessibility-complete flows for:

- workspace switcher;
- organization creation and selection;
- Members and organization invites;
- organization mailboxes;
- Proton Relay and Bridge Devices;
- health/degraded/offline/needs-attention states;
- customer-safe errors and repair entrypoints.

Build against canonical TypeScript contracts and fixtures; label unimplemented actions clearly in development, not as shipped product.

## Milestone 2: Platform integration

- replace fixtures with Sol APIs;
- enforce role-based visibility without treating UI hiding as authorization;
- preserve existing personal portal/OAuth/MCP flows;
- ensure workspace context is explicit in URLs/session state and never mixes mailbox data;
- distinguish private-beta signup invites from Team invitations.

## Milestone 3: Bridge onboarding and desktop shell

Target customer flow:

```text
Install Bridge → Sign in → Choose Organization → Approve Device → Connect Proton → Healthy
```

Technical fields stay in diagnostics. Before choosing desktop technology, compare daemon/service control, Windows/macOS/Linux support, secure storage, updater safety, UI/accessibility, binary size, TypeScript reuse, and maintenance. Coordinate the decision with Claude; the UI shell must not own Bridge Core.

## Security and accessibility constraints

- never display/copy/log raw provider, gateway, device, provisioning, or tunnel secrets;
- UI-supplied tenant/workspace IDs are never authorization;
- destructive account disconnect and device revocation require clear consequences/confirmation;
- sending remains human-confirmed outside Bridge onboarding;
- keyboard navigation, focus management, labels, error association, contrast, reduced motion, and responsive layouts are baseline requirements;
- offline/degraded states must not imply complete mailbox intelligence.

## Definition of done

- personal-only behavior remains simple and compatible;
- organization/relay flows use canonical contracts and real API error semantics;
- responsive/accessibility checks cover critical paths;
- empty/loading/offline/degraded/revoked/expired states are explicit;
- desktop decision is documented before scaffolding a framework;
- e2e tests cover workspace isolation and onboarding state transitions;
- exact root/product validation and deployment status are reported.

## Handoff format

Report: screens/flows changed; contracts/endpoints consumed or requested; fixture assumptions; role/accessibility behavior; responsive states; e2e commands/results; screenshots if useful; known backend/Bridge gaps; integration risks.
