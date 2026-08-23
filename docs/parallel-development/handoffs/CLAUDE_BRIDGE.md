# Bridge branch handoff — Claude Opus 5

Session: 2026-08-23. Branch: `main` (three agents share this worktree; commits below
touch only Bridge-owned paths).

Commits: `cb58e54` feat(bridge): introduce Bridge Core, daemon, and CLI ·
`427db2b` feat(infra): add managed systemd service and AlmaLinux Bridge installer.

## Implemented

- **Bridge Core** (`apps/bridge/src/core/`) — one object owning config, secrets, device
  identity, gateway, Proton discovery, tunnel, health, diagnostics, and repair. The
  daemon, the CLI, and the desktop local API are thin entrypoints over it.
- **Proton Gateway extracted and hardened.** Behaviour preserved (same `/v1` surface,
  same normalized message shape, same per-request Proton account selection). Added:
  per-device authentication with replay protection, request size and rate limits,
  shape-validated caller context, honest `/v1/health`, generic error bodies, IMAP/SMTP
  connection timeouts, and a real STARTTLS fix (see Security).
- **Device provisioning client** — OAuth-device-grant-shaped browser authorization,
  organization-scoped renewable credential, renewal inside the last quarter of its life,
  rotation applied from a heartbeat response, and revocation that erases the local
  credential and stops the relay while still explaining itself.
- **Headless daemon** (`apps/bridge/src/daemon.ts`) — serves the gateway, supervises the
  managed tunnel, heartbeats on a server-directed interval, exposes the local API, keeps
  serving Proton through transient Cloud failures, and stops cleanly on SIGTERM.
- **CLI** (`apps/bridge/src/cli.ts`) — `setup`, `status`, `doctor`, `start`, `stop`,
  `restart`, `accounts`, `logs`, `repair`, `service install|uninstall`, `version`.
  `status`/`doctor`/`accounts`/`repair` use the running daemon when it is up. No fake
  commands: everything listed does something real.
- **Proton Bridge discovery** — install location, version, and endpoint probing behind
  OS adapters. States: `not_installed`, `stopped`, `running`, `unsupported_version`,
  `unknown`. Verified against real Proton Mail Bridge 3.25.0 on this host.
- **Cloudflare Tunnel lifecycle** — cloudflared discovery, scoped credential start,
  readiness from the local metrics endpoint, detection of an externally managed
  `cloudflared` service so Bridge does not race an admin's own unit.
- **Health + diagnostics + repair** — derived from one `BridgeObservation` by pure
  functions in `@mailwarden/relay`, so CLI, desktop, and Cloud share one interpretation.
- **Secret store** — `SecretStore` interface; Secret Service (`secret-tool`) when a
  keyring actually answers, otherwise a 0600 file that `doctor` flags as weaker.
- **Infrastructure** — `mailwarden-bridge.service` generated from the same planner the
  CLI prints, and `infra/almalinux/install-bridge.sh`.

## Bridge architecture in code

```text
packages/contracts/src/index.ts    Bridge/relay wire contracts (additive)
packages/proton/src/discovery.ts   Proton Bridge discovery state machine (pure + adapters)
packages/relay/src/observation.ts  health aggregation, diagnostics rules (pure)
packages/relay/src/gateway-auth.ts gateway auth: signing, verification, replay, rate limit
apps/bridge/src/core/
  paths.ts        system vs XDG layout
  config.ts       versioned config (no secret fields) + legacy env overrides
  secrets.ts      SecretStore: SecretServiceStore | FileSecretStore
  system.ts       real OS adapters (which/run/probeTcp/fileExists)
  log.ts          redacting logger
  cloud.ts        MailwardenCloudClient: HttpCloudClient | DevCloudClient
  identity.ts     provisioning, renewal, rotation, revocation
  gateway.ts      the Proton Gateway
  tunnel.ts       cloudflared lifecycle
  accounts.ts     per-account relay activity
  bridge.ts       BridgeCore facade
  local-api.ts    loopback API for the desktop shell
  service.ts      systemd plan (install/uninstall)
apps/bridge/src/daemon.ts / cli.ts / gateway.ts (legacy entrypoint)
src/services/proton-gateway.ts     re-export shim, kept for the transition
```

## Contracts changed (additive only — Sol has final authority)

Added to `packages/contracts/src/index.ts`:

`BridgeVersion`, `BridgePlatformSupport`, `RelayProvisioningStartRequest`,
`RelayProvisioningStartResponse`, `RelayProvisioningState`,
`RelayProvisioningPollResponse`, `RelayDeviceCredential`, `BridgeComponent`,
`BridgeComponentStatus`, `BridgeComponentHealth`, `BridgeHealth`,
`RelayHeartbeatResponse`, `RelayTunnelCredential`, `BridgeDiagnosticSeverity`,
`BridgeRemediation`, `BridgeDiagnostic`, `BridgeDiagnosticReport`,
`BridgeRepairAction`, `BridgeRepairResult`.

Nothing existing was renamed or removed. `RelayDevice`, `RelayStatus`,
`RelayCapabilities`, and `RelayHeartbeat` are used as Sol defined them.
`RelayProvisioningRequest`/`RelayProvisioningResponse` (the pre-existing pair) are left
untouched; the new device-grant types supersede them for the device flow, and Sol should
decide whether to retire the old pair.

`packages/relay` now depends on `@mailwarden/contracts` and `@mailwarden/proton`.

## Cloud protocol expected from Sol

Routes are declared in one place: `CLOUD_ROUTES` in `apps/bridge/src/core/cloud.ts`.
Every request carries `X-Mailwarden-Bridge-Protocol: 1`; device-authenticated requests
send `Authorization: Bearer <deviceSecret>`.

| Route | Body → Response |
| --- | --- |
| `POST /api/bridge/v1/provisioning/start` | `RelayProvisioningStartRequest` → `RelayProvisioningStartResponse` |
| `POST /api/bridge/v1/provisioning/poll` | `{ deviceCode }` → `RelayProvisioningPollResponse` |
| `POST /api/bridge/v1/devices/heartbeat` | `{ heartbeat: RelayHeartbeat, health: BridgeHealth, generation }` → `RelayHeartbeatResponse` |
| `POST /api/bridge/v1/devices/credential/renew` | `{ deviceId, generation }` → `RelayDeviceCredential` |
| `POST /api/bridge/v1/devices/tunnel` | `{ deviceId }` → `RelayTunnelCredential` (404 = no managed tunnel) |
| `GET /api/health` | reachability probe |

Semantics Bridge relies on:

- `deviceCode` is opaque, single-use, short-lived; the human authorizes and picks the
  organization in the browser. `userCode` is the short code the CLI prints.
- 401/403 on a device-authenticated route means *revoked*: Bridge erases its credential.
  Use another status for transient failures, or a device will de-register on an outage.
- `RelayDeviceCredential` is returned exactly once per issue/rotation and carries a
  monotonic `generation`; Cloud should reject stale generations.
- `gatewaySecret` is the secret Cloud presents (or signs with) when calling that device's
  gateway. Storing it as the Proton mailbox's `gatewayApiKey` gives per-device,
  independently revocable gateway auth with **no Cloud code change**.

Until these exist, `DevCloudClient` implements the same state machine in-process and
persists to `<stateDir>/dev-cloud.json` so CLI and daemon agree across processes.

## Local API exposed to Gemini (desktop)

`http://127.0.0.1:8765/v1`, bearer token from `<runtimeDir>/local-api.token` (0600,
same-user). Requests with a non-localhost `Origin` are rejected; a native shell sends
none.

| Endpoint | Returns |
| --- | --- |
| `GET /status` | version, deviceName, registered, revoked, deviceId, organizationId, tunnelHostname, `BridgeHealth` |
| `GET /health` | `BridgeHealth` |
| `GET /diagnostics` | `BridgeDiagnosticReport` |
| `GET /accounts` | per-account activity + `{configured, connected}` |
| `POST /repair` | `{action: BridgeRepairAction}` → `BridgeRepairResult` |
| `POST /setup` | starts device authorization (202) |
| `GET /setup` | `idle` \| `pending` (with `userCode` + `verificationUri`) \| `authorized` \| `failed` |

The desktop shell never parses command output and never needs to know about IMAP ports,
STARTTLS, cloudflared, or systemd. Render `BridgeHealth.status` for the headline and
`components[]` for the rows; render `BridgeDiagnostic.remediation` to decide whether to
offer a repair button (`automatic`), a setup flow (`user_action`), Proton instructions
(`proton_login`), or an admin message (`administrator`).

## Security decisions

- **No permanent organization secret on a device.** Browser authorization → scoped,
  renewable, per-device credential. Revocation is per device.
- **Gateway auth** — preferred `device-signature` (HMAC over method/path/timestamp/body
  hash, ±300s window, single-use signature so a captured request cannot be replayed);
  `device-token` bearer; `legacy-shared-key` for pre-existing relays, which logs a warning
  on every request. All comparisons are constant-time.
- **Secrets never in config, argv, or logs.** The config file is secret-free by design
  (asserted by a test). The tunnel token goes to cloudflared via `TUNNEL_TOKEN`, never
  `--token`, because argv is world-readable through `ps`. The logger redacts any field
  whose name looks like a credential; a test asserts a Bridge password cannot reach logs.
- **Loopback only.** The gateway refuses to bind anything but loopback and refuses to
  disable TLS verification for a non-loopback Proton host.
- **Real STARTTLS fix.** Loopback STARTTLS to Proton Bridge failed on current Node/Bun
  with `servername argument must be an string` (an IP is not permitted as SNI). The
  gateway now passes `servername: "localhost"` with verification off, which is correct
  for Bridge's self-signed loopback certificate. This was broken on the previous code
  path too — worth re-testing the live relay after integration.
- **Input validation** — caller context ids are shape-checked before reaching IMAP or a
  log line; message UIDs must be positive integers; only three mutations are accepted;
  bodies are capped; requests are rate-limited.
- **Unprivileged service** — the systemd unit runs as `mailwarden`, with
  `NoNewPrivileges`, `ProtectSystem=strict`, `UMask=0077`, and write access only to its
  state directory. The installer prints every privileged command.
- **Headless credential storage tradeoff** — with no unlocked keyring, credentials live in
  a 0600 file. `doctor` reports this as a warning rather than hiding it.

## Infrastructure changes

- `infra/systemd/mailwarden-bridge.service` (generated) — one supervised unit.
- `infra/almalinux/install-bridge.sh` — install/uninstall, idempotent, non-destructive.
- `infra/{systemd,almalinux,cloudflare,packaging}/README.md` updated.
- `docs/operations/ALMALINUX.md` and `RELAY_OPERATIONS.md` rewritten around the managed
  path, with the manual path kept as the advanced/recovery route.
- `package.json`: `bridge`, `bridge:daemon`; `dev:bridge` now runs the daemon;
  `proton:gateway` still runs the legacy gateway entrypoint.

## Supported platforms (factual)

| Platform | Status |
| --- | --- |
| Linux x64 | SUPPORTED — Bridge Core, daemon, CLI, systemd, discovery, tunnel exercised here |
| Linux arm64 | EXPERIMENTAL — same code path, no arm64 hardware run |
| macOS | PLANNED — needs launchd + Keychain adapters |
| Windows | PLANNED — needs service + Credential Manager adapters |

## Tests

`bun test` → **225 pass, 0 fail** (baseline was 136; 89 of the new tests are Bridge and
other agents added the rest). `bunx tsc --noEmit` → **0 errors**. `bun run build`
(wrangler dry-run) → **PASS**. Not deployed; production untouched;
`MAILBOX_MUTATIONS_ENABLED` still `false`.

Bridge test files: `tests/bridge_gateway.test.ts` (23), `tests/bridge_core.test.ts` (20),
`tests/bridge_relay_lifecycle.test.ts` (31) — covering gateway auth modes, replay,
rate/size limits, context validation, account selection, send formatting, log redaction,
TLS options, config versioning, secret-store permissions and repair, provisioning,
renewal, revocation, discovery states, health aggregation, diagnostics routing, tunnel
argv safety, external-cloudflared detection, Bridge Core setup, and local API auth.

Manual verification on this host (real Proton Mail Bridge 3.25.0, real cloudflared
2026.7.3): `doctor` detected the running Proton Bridge and a genuine port-8080 conflict;
`setup` registered a device against the dev adapter; the daemon served an authenticated
`/v1/health` that reported IMAP and SMTP reachable, spawned cloudflared (which correctly
rejected the fake dev token), and stopped cleanly on SIGTERM.

## Known gaps

- No packaged binary or installer beyond source + systemd; no updater.
- Managed tunnel provisioning is exercised only against the dev adapter.
- Proton Bridge installation and account login remain manual by design.
- Cloud does not yet sign gateway requests; the signed mode is implemented and exported.
- Bridge credentials still travel as request headers.
- Connection pooling is not implemented (one IMAP connection per request; marked in code).
- No arm64/macOS/Windows adapters.

## Integration steps

1. Merge contracts first (additive; nothing renamed).
2. Sol implements the six routes above. Point Bridge at real Cloud with
   `mailwarden-bridge setup --cloud=https://<host>`; no Bridge code change is needed.
3. For per-device gateway auth with no Cloud code change, store the device's
   `gatewaySecret` where the Proton mailbox currently keeps `gatewayApiKey`.
4. Retire `PROTON_GATEWAY_API_KEY` per relay once its device is registered.
5. Gemini points the desktop shell at the local API contract above.

## Requests for Sol

- Review and integrate the contract additions; decide the fate of the older
  `RelayProvisioningRequest`/`RelayProvisioningResponse` pair.
- Implement the six Cloud routes, and please keep 401/403 meaning *revoked* on
  device-authenticated routes — Bridge treats it as authoritative.
- Persist and rotate `gatewaySecret` per device, and expose device revocation in the
  portal path so a lost device can be cut off without touching other relays.
- Managed tunnel provisioning: Cloud holds the Cloudflare account token and returns only
  `RelayTunnelCredential` per device.
- Optional, higher assurance: adopt `signGatewayRequest` from `@mailwarden/relay` in the
  Cloud Proton provider so gateway calls are signed rather than bearer-authenticated.

## Requests for Gemini

- Consume `BridgeHealth.status` and `components[]` directly; do not re-derive status in
  the UI, and do not parse CLI output.
- Drive repair buttons from `BridgeDiagnostic.remediation`, and show `remedy` verbatim —
  it is written to be customer-readable and is already redacted.
- Setup UX: `POST /setup`, then poll `GET /setup` and show `userCode` +
  `verificationUri` while `pending`.
- Tell me if the desktop shell needs a push/stream instead of polling, or fields the
  local API does not expose yet; I will add them rather than have the UI infer them.
