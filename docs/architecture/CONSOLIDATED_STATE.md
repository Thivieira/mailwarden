# Mailwarden consolidated state

This is the architecture **after** the three parallel implementation streams
(Platform, Bridge, Product) were merged into one system. It supersedes the
per-agent handoffs in `docs/parallel-development/`, which remain as history.

## System

```text
Portal + Desktop  ── product surfaces
        │
        ▼
Mailwarden Cloud (Cloudflare Worker + D1)
  identity · workspaces · organizations · mailboxes · relay devices · MCP
        │
        │  Bridge v1 protocol (device-authenticated HTTPS)
        ▼
Mailwarden Bridge (customer host)
  device identity · Cloudflare Tunnel · Proton Gateway · diagnostics · repair
        │
        ▼
Proton Mail Bridge → Proton Mail
```

Two protocols cross the Cloud/Bridge boundary, in opposite directions:

| Direction | Path | Auth |
| --- | --- | --- |
| Bridge → Cloud | `/api/bridge/v1/*` | `Authorization: Bearer <deviceSecret>` + `X-Mailwarden-Bridge-Protocol: 1` |
| Cloud → Bridge (mail) | `<endpoint>/v1/*` | per-device `gatewaySecret`, bearer or signed |
| Cloud → Bridge (control) | `<endpoint>/v1/control/*` | signed request required for repair |
| Cloud → Cloudflare | tunnel allocation | Mailwarden's account token, never sent to a device |

`<endpoint>` is what the device reports in its heartbeat (`BridgeHealth.endpoint`)
— its managed tunnel hostname, or an operator-configured URL. No endpoint means
Cloud-initiated diagnostics and repair are unavailable and say so.

Managed tunnels are allocated per device: Cloud creates the tunnel, points its
ingress at that device's loopback gateway, publishes a hostname under
`RELAY_HOSTNAME_SUFFIX`, and returns only the run token. Allocation stays off
until the Cloudflare settings exist, and the endpoint answers `404` until then.

## Repository

```text
apps/
  cloud/      Worker entrypoints
  bridge/     Bridge Core, daemon, CLI, gateway
  desktop/    companion shell over the Bridge local API
packages/
  contracts/  cross-runtime types — the single source of shared meaning
  db/         canonical D1 schema (Platform-owned semantics)
  auth/       permission scopes
  organizations/ role ranking and plan capabilities
  proton/     Proton Bridge discovery and gateway URL validation
  relay/      health/diagnostics rules, gateway auth and signing
  ui/         shared design tokens, badges, error translation
infra/        systemd units, AlmaLinux installer, packaging notes
migrations/   0000–0007, append-only
src/          Cloud implementation (services, routes, MCP, portal UI)
tests/        unit, security, and cross-system integration suites
```

`src/` remains the Cloud implementation. It is extracted into packages only when
that clearly improves ownership — the Proton Gateway was; the mail services have
no second consumer yet and stayed.

## Canonical concepts

One representation each, all in `@mailwarden/contracts`:

| Concept | Type | Notes |
| --- | --- | --- |
| Workspace / Organization | `Workspace`, `Organization`, `WorkspaceKind` | Team Organizations are tenants with `kind=team` |
| Membership | `Membership`, `MembershipRole` | live membership is the only thing that authorizes |
| Invitation | `OrganizationInvite` | distinct from private-beta invites |
| Mailbox | `Mailbox` | workspace-scoped summary |
| Relay device | `RelayDevice`, `RelayStatus`, `RelayCapabilities` | carries the latest `BridgeHealth` |
| Device credential | `RelayDeviceCredential` | `deviceSecret` hashed, `gatewaySecret` encrypted, both per device |
| Provisioning | `RelayProvisioningStart*`, `RelayProvisioningPollResponse` | device-authorization grant |
| Health | `BridgeHealth`, `BridgeComponentHealth` | one snapshot for CLI, desktop, Cloud, portal |
| Diagnostics | `BridgeDiagnostic*`, `BridgeRemediation` | remediation class drives what the UI offers |
| Repair | `BridgeRepairAction`, `BRIDGE_REPAIR_ACTIONS` | one vocabulary across all four surfaces |
| Plan | `PlanCapabilities`, `PlanId` | server-side quotas |

Removed during consolidation: `RelayProvisioningRequest` / `RelayProvisioningResponse`
(superseded generation, no consumers) and the portal's private device shape.

## What each layer owns

**Platform (Cloud).** Identity, workspaces, memberships and authorization, invites,
mailbox scoping, plan quotas, relay device persistence, provisioning sessions,
credential issue/rotation/revocation, MCP workspace context, audit events. D1 is
reached only from here.

**Bridge.** Device identity and secret storage, Proton Gateway, Proton Bridge
discovery, Cloudflare Tunnel lifecycle, health interpretation, diagnostics, repair,
systemd lifecycle. Bridge never touches D1 and holds no organization-wide secret.

**Product.** Portal (workspace switcher, organization dashboard, members, invites,
mailboxes, relay, devices, plan) and the desktop companion. Both render what the
other layers report; neither re-derives status nor parses command output.

## Trust and credentials

- A device receives an organization-scoped, renewable credential after a human
  approves its short code in the portal. `deviceSecret` is stored hashed; the
  per-device `gatewaySecret` is envelope-encrypted with tenant-bound AAD.
- Revocation is per device. On the next heartbeat the daemon erases its local
  credential, stops relaying, and still explains itself to `status` and `doctor`.
- Renewal happens in the last quarter of a credential's life; a superseded
  generation stops working immediately.
- Cloud → Bridge repair requires a *signed* request, so a bearer token that leaked
  into a log cannot trigger state changes. Reads accept either mode.
- The legacy deployment-wide `PROTON_GATEWAY_API_KEY` still authenticates the
  gateway for relays that predate device identity. It is deprecated, logs a warning
  on every request, and should be retired per relay once its device is registered.
- Provisioning starts on a public endpoint, so it is rate limited
  (`RELAY_PROVISIONING_STARTS_PER_MINUTE`, default 30/min) and expired sessions
  are purged on each start.

## Verified interoperability

| Boundary | Status |
| --- | --- |
| Platform ↔ Bridge | provisioning, registration, heartbeat, renewal, revocation over real HTTP (`tests/integration_platform_bridge.test.ts`) |
| Cloud ↔ Bridge control | signed diagnostics and repair against a live gateway (`tests/integration_bridge_control.test.ts`) |
| Bridge ↔ Desktop | authenticated local API, real state, honest unreachable state (same file) |
| Platform ↔ Portal | workspaces, organizations, members, invites, mailboxes, relay devices (`tests/portal_and_organizations.test.ts`) |
| Bridge ↔ Proton Bridge | discovery and STARTTLS verified against real Proton Mail Bridge 3.25.0 |
| Bridge ↔ cloudflared | discovery and lifecycle verified against real cloudflared 2026.7.3 |

## Known gaps

- Cloud→gateway *mail* requests still use bearer auth; the signed mode is
  implemented and used by the control plane.
- Some attention/waiting/policy intelligence remains creator-scoped rather than
  team-shared.
- No invite email delivery, no ownership-transfer flow, no MCP workspace picker.
- No packaged Bridge binary, updater, or macOS/Windows adapters.
- Production migrations for 0006/0007 have not been applied.
