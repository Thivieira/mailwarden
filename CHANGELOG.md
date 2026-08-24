# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2] - 2026-08-24

### Changed

- Softened the modal backdrop overlay to a clean translucent frosted wash, removing the heavy dark background.
- Added automatic `overflow: hidden` on `document.body` and `document.documentElement` when modals are active to prevent background scrolling.
- Center modal dialogs vertically and horizontally in the active viewport with safe internal scrolling.
- Added `Escape` key shortcut to dismiss open modals and reset body overflow.

## [1.3.1] - 2026-08-23

### Added

- Standardized Lucide-compliant SVG brand and interface icons (`UserIcon`, `BuildingIcon`, `BotIcon`, `GoogleBrandIcon`, `MicrosoftBrandIcon`, `ProtonBrandIcon`, `LaptopIcon`, `ServerIcon`, etc.) replacing raw unicode escape sequences across all templates.
- Complete portal design system with uniform `.btn` variants, `.badge-pill`, pulsing `.status-dot` indicators, `.provider-btn`, and monospace `.code-input-group` developer fields.
- Token visibility toggle and animated clipboard copy feedback (`✓ Copied!`) for MCP credentials.

### Changed

- Modernized the Web Portal dashboard (`/portal`) layout with high-contrast "Personal Mail Vault" greeting banner, clean mailbox list cards, and polished responsive modal dialogs.
- Standardized OAuth provider buttons for Google, Microsoft 365, and Proton Mail with consistent hover states and brand marks.
- Refined workspace switcher dropdown and organization navigation tabs.

## [1.3.0] - 2026-08-23

### Added

- Cloud signs Proton Gateway requests with the selected workspace relay device's
  per-device secret. Older relays retain the deprecated bearer compatibility path.
- Failed Cloudflare Tunnel and DNS revocations are recorded in
  `relay_tunnel_cleanup` and retried by the 15-minute reconciliation loop, while
  local device revocation remains immediate and authoritative.
- Migration `0010` adds the durable tunnel-cleanup queue.

### Fixed

- D1 commands now run through `scripts/d1.sh`, which exports the account selected
  by `wrangler.jsonc` because Wrangler's migration subcommands do not honor that
  file's `account_id` when credentials expose multiple accounts.

## [1.2.0] - 2026-08-24

### Added

- **Managed Cloudflare Tunnel allocation.** Mailwarden Cloud now provisions a
  dedicated tunnel per relay device: it creates a remotely-managed tunnel, points
  the ingress at that device's loopback gateway, publishes a hostname under
  `RELAY_HOSTNAME_SUFFIX`, and returns only that tunnel's run token. Mailwarden's
  Cloudflare account token never leaves Cloud and the run token is never stored in
  D1 — it is fetched from Cloudflare when the device asks. A customer host
  connects outbound with no inbound port, no static IP, and no certificate of its
  own, and revoking a device deletes its tunnel and DNS record.
- Devices tell Cloud which loopback service to publish, and Cloud refuses anything
  that is not loopback: a managed tunnel cannot be turned into a route into the
  customer's private network.
- Relay devices carry their allocated hostname (`RelayDevice.tunnelHostname`), so
  the portal can show where a relay is published.
- Migration `0009` adds the per-device tunnel columns.

### Changed

- `POST /api/bridge/v1/devices/tunnel` returns a `RelayTunnelCredential` when
  managed tunnels are configured. It still answers an authenticated `404`
  otherwise, so a deployment without Cloudflare credentials keeps using an
  operator-run tunnel rather than pretending to have provisioned one.

## [1.1.1] - 2026-08-24

### Fixed

- `beta_invites` timestamps were written in two different units. The operator
  script `scripts/create-invite.ts` built raw SQL with `Date.getTime()`
  (milliseconds) while the schema declares `mode: "timestamp"` (seconds), so
  invites created that way read back as dates thousands of years in the future
  and their expiry check could never fail. The script now shares one builder with
  the service, writes seconds, escapes the email it interpolates, and prints the
  code it actually stored — previously the local path printed a code it had not
  written. Migration `0008` normalizes existing rows.
- `validateInvite` refuses an invite whose expiry is beyond any real lifetime,
  so a mis-encoded row fails closed instead of never expiring.
- `/api/workspaces` returned authorization contexts rather than workspaces, so
  clients read `kind` as `undefined`.
- The Bridge daemon waited out its 30-second interval floor before the first
  heartbeat, and died outright when its gateway port was in use. It now reports
  immediately, survives a port conflict, and reports the conflict instead of
  mistaking another process's gateway for its own.

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

[1.3.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.3.0
[1.2.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.2.0
[1.1.1]: https://github.com/Thivieira/mailwarden/releases/tag/v1.1.1
[1.1.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.1.0
[1.0.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.0.0
