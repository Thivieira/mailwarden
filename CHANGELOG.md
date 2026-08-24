# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-23

Team Organizations, Mailwarden Bridge, and the product surfaces that use them.
Personal Workspaces are unaffected: existing tenant ids, sessions, tokens, and
encrypted provider credentials keep working unchanged.

### Added

- **Workspaces and Team Organizations.** Global identity on the existing `users.id`,
  Personal Workspace compatibility, Team Organizations as `tenants.kind=team`,
  membership-backed authorization with owner/admin/member roles, active workspace
  selection with workspace-scoped tokens, organization invites, and server-side
  plan capabilities and quotas.
- **Mailwarden Bridge.** A Bridge Core shared by a headless daemon, a CLI
  (`setup`, `status`, `doctor`, `start`, `stop`, `accounts`, `logs`, `repair`,
  `service`), and the desktop companion. Device identity via browser
  authorization, organization-scoped renewable credentials, rotation, revocation,
  heartbeat, health, diagnostics, and safe repair.
- **Proton Gateway extracted and hardened.** Per-device authentication with HMAC
  signing and replay protection, request size and rate limits, validated caller
  context, honest health, generic error bodies, and connection timeouts.
- **Proton Bridge discovery and Cloudflare Tunnel lifecycle**, both behind OS
  adapters, with cloudflared started using `TUNNEL_TOKEN` rather than argv.
- **Cloud → Bridge control plane.** Authenticated diagnostics and repair on the
  device, reached with a signed request using that device's own gateway secret.
  Repair is admin-only and audited.
- **Portal**: workspace switcher, organization dashboard, member management,
  invitations, workspace-scoped mailboxes, Proton Relay and Bridge Devices views,
  plan and security quotas.
- **Desktop companion** over the Bridge local API.
- **Infrastructure**: `mailwarden-bridge.service`, an AlmaLinux installer that
  prints every privileged command, and updated operations documentation.
- Migrations `0006_platform_workspaces_and_relays.sql` and
  `0007_global_identity_email_claims.sql`.

### Changed

- One canonical repair-action vocabulary shared by Bridge, Cloud, portal, and desktop.
- Relay device protocol consolidated on `/api/bridge/v1/*`; the unversioned
  duplicates were removed. `/api/relay/provisioning/authorize` remains for the
  human approval step.
- Portal and desktop render real device health; placeholder devices, invented
  account rosters, and simulated repair results were removed.

### Fixed

- Bind send confirmation to a human browser session (`mw_human_session`), closing the reviewUrl+nonce bypass
- Unify reviewed and Gmail-dispatched outbound payload (canonical hash, signature once, reject unsupported fields)
- Proton Bridge loopback STARTTLS failed with `servername argument must be an string`
  because an IP address cannot be used as a TLS server name; verified against real
  Proton Mail Bridge 3.25.0.

### Security

- Per-device relay credentials replace the deployment-wide gateway bearer, which is
  now deprecated and warns on every request.
- Device secrets are stored hashed; per-device gateway secrets are envelope-encrypted
  with tenant-bound AAD; Bridge keeps its credentials in a secret store, never in config.
- The public provisioning endpoint is rate limited and expired sessions are purged.
- Repair requires a signed request, so a leaked bearer token cannot change device state.

### Documentation

- `docs/architecture/CONSOLIDATED_STATE.md` describes the system after integration
- Dogfood runbook corrected for ChatGPT Developer Mode and approve-then-mutate Phase 9
- Session wrap: `docs/HARDENING_WRAP_2026-08-17.md`

## [1.0.0] - 2026-08-16

First public release of Mailwarden: an AI-native email operating layer and MCP boundary.

### Added

- Multi-tenant identity, sessions, scopes, and structured audit events
- Envelope encryption (AES-256-GCM) for provider credentials
- Gmail, Microsoft 365, Proton Bridge, and mock provider adapters
- Deterministic attention queue, classification signals, and user-correction overrides
- Drafts, signatures, SHA-256 send-approval hashing, and idempotent sending
- MCP server (stdio and SSE) plus Elysia HTTP API on Cloudflare Workers / D1
- Privacy controls: disconnect, credential wipe, memory deletion, data export
- Dry-run mailbox mutations (`MAILBOX_MUTATIONS_ENABLED=false` by default)

[1.1.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.1.0
[1.0.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.0.0
