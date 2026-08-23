# Claude Opus 5 kickoff: Mailwarden Bridge and relay

## Mission

Own everything between Mailwarden Cloud and Proton Mail, evolving the current manual gateway/tunnel deployment into one productized Bridge Core used by daemon, CLI, desktop, and headless service runtimes.

## Owned directories

- `apps/bridge/`
- `packages/proton/`
- `packages/relay/`
- `infra/`
- Bridge/relay tests
- Bridge architecture and operations documentation

The current gateway implementation is transitional at `src/services/proton-gateway.ts`; coordinate its extraction with Sol because Cloud provider/tests still reference `/src` boundaries.

## Non-owned directories

- D1 schema/migrations, global identity, membership semantics, and final shared contracts belong to Sol.
- portal/desktop presentation and customer interaction design belong to Gemini.

Propose contract needs; do not create a second database or organization model.

## Current state

- `apps/bridge/src/gateway.ts` starts the existing Hono Proton Gateway.
- Gateway talks to local Proton Bridge via IMAP/SMTP STARTTLS and binds loopback.
- Cloud provider can send per-account Bridge username/password and tenant/user/account context headers through HTTPS.
- One gateway bearer key authorizes the deployment.
- Cloud connector service registers per-account connector tokens and heartbeat/status.
- AlmaLinux and systemd are documented manual reference paths.
- No Bridge daemon, CLI commands, config model, standalone package, provisioning, tunnel automation, device identity, revocation channel, secret-store adapter, installer, updater, diagnostics bundle, or repair state machine exists.

Proton officially supports Bridge on desktop OSes and currently names Ubuntu LTS/Fedora for Linux support. AlmaLinux is Mailwarden-tested reference territory. Linux Bridge requires a password manager and a paid Proton plan.

## Required Platform contracts

Request reviewed contracts from Sol for:

- browser/device authorization and short-lived provisioning token;
- RelayDevice identity/status/capabilities;
- device credential enrollment, renewal, rotation, revocation;
- heartbeat payload and freshness/version rules;
- organization selection and relay inheritance;
- Cloud-to-relay request authentication/assertion;
- stable API errors and protocol versioning.

Do not ship the current shared gateway key as the future device credential.

## Milestone 1: isolate Bridge Core

1. Characterize existing gateway endpoints and add focused tests.
2. Remove Cloud utility imports from gateway code without rewriting behavior.
3. Define versioned local config with no plaintext secret fields in general config.
4. Add health probes for gateway and Proton Bridge.
5. Add daemon/CLI entrypoints around the same core.
6. Preserve `bun run proton:gateway` compatibility.

## Milestone 2: device provisioning and Cloud client

- implement Sol's approved provisioning flow;
- store renewable device credential through a secret-store abstraction;
- organization selection and relay registration;
- heartbeat with version/capabilities/degraded reasons;
- revocation awareness and credential rotation;
- signed/scoped relay request verification;
- redacted diagnostics.

## Milestone 3: Proton and tunnel lifecycle

- verify official Proton Bridge discovery/CLI/lifecycle interfaces on each target;
- keep account login interactive until supported automation is proven;
- provision/start/stop a device-scoped Cloudflare Tunnel without exposing account tokens;
- install/uninstall services with rollback;
- repair individual edges rather than reinstall everything;
- qualify AlmaLinux first, then Ubuntu/Debian, Windows, and macOS adapters.

## Security constraints

- bind gateway to loopback behind Tunnel;
- never log Bridge passwords, Proton login credentials, gateway/device/tunnel tokens, or message bodies;
- native secret storage on desktop; verified secure alternative on headless Linux;
- independent device revocation;
- request size/rate/time limits and replay protection;
- no direct D1 access;
- no automatic updater before signing, rollback, and interrupted-upgrade recovery.

## Definition of done

- one tested Bridge Core serves daemon and CLI;
- current gateway behavior and dynamic account selection remain compatible;
- device provisioning/renewal/revocation use approved Platform contracts;
- tunnel and Proton states produce actionable redacted health;
- AlmaLinux service install/repair/uninstall is documented and reversible;
- root and Bridge-specific gates pass or exact baseline failures are explained;
- no production deploy or real credential mutation without explicit authorization.

## Handoff format

Report: runtime/files changed; contract requests/usage; platform matrix tested; secrets and storage; service/tunnel changes; exact tests; manual verification; unsupported cases; rollback; Product UX needs; integration risks.
