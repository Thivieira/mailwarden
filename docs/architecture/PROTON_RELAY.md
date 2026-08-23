# Proton relay architecture

Proton is not another cloud API adapter. Proton Mail Bridge decrypts mail locally and exposes local IMAP/SMTP, so Mailwarden requires a customer-controlled relay path.

## Data path

```text
Mailwarden Cloud
  → authenticated HTTPS
Cloudflare Tunnel
  → loopback HTTP
Mailwarden Proton Gateway
  → loopback IMAP/SMTP with STARTTLS
Proton Mail Bridge
  → Proton encrypted service
Proton Mail
```

Proton explains that Bridge creates IMAP/SMTP servers on the local machine because normal IMAP clients cannot decrypt zero-access encrypted mail. Cloudflare Tunnel establishes outbound-only connections and does not require public inbound ports or a public IP.

## Current request protocol

**SHIPPED/PARTIAL:** the Cloud Proton provider sends:

- `Authorization: Bearer <gateway key>`
- `X-Tenant-Id`
- `X-User-Id`
- `X-Account-Id`
- optional `X-Proton-Username`
- optional `X-Proton-Password`

The gateway exposes `/v1/health`, search, message/thread, mutation, draft, and send operations. A configured gateway URL normally includes the `/v1` prefix. Non-local gateway URLs must use HTTPS, and known metadata endpoints are rejected.

Per-request Bridge credentials allow one Bridge/gateway host to serve multiple logged-in Proton accounts. This is implemented, but capacity, account limits, official support, and failure isolation have not been qualified; do not describe it as unlimited.

## Trust boundaries

- Cloud authenticates the user/workspace and owns D1.
- Cloud decrypts the mailbox's stored provider credentials only for the authorized tenant/user request.
- Tunnel protects transport and removes public origin exposure; it does not replace gateway/device authentication.
- Gateway currently trusts Cloud-supplied tenant/user/account headers after checking one gateway bearer key.
- Proton Bridge holds Proton account state and decrypts locally.

The current gateway key is a deployment secret, not the future device identity model. Organization relays require independently registered device credentials, replay resistance, rotation, revocation, request scoping, and audit events.

## Organization relay inheritance

**PLANNED:** an organization owner registers a relay device once. Members connecting Proton select the organization; Cloud resolves the inherited healthy relay and sends only the member mailbox's authorized work to it. Members never configure hostname, API secret, ports, certificates, systemd, or cloudflared.

## Multiple relays

The shared contract permits multiple devices per organization even if an initial plan exposes one. Relay selection, failover, consistency, and credential placement remain open. Do not implement high availability before single-device registration, revocation, and health are correct.

## Headless server and desktop relay

- AlmaLinux/RHEL-compatible is Mailwarden's first reference server deployment, documented as a manual path.
- Proton officially names Ubuntu LTS and Fedora as supported Linux distributions; the AlmaLinux reference needs Mailwarden-owned compatibility testing.
- Windows, macOS, and Linux Desktop will use the same Bridge Core behind platform-specific service and secret-store adapters.

## Mailwarden-controlled namespace

**PLANNED:** managed tunnel provisioning allocates a hostname under a Mailwarden-controlled relay namespace. Customer DNS and custom domains are not first-release requirements. Custom domains can remain an Enterprise concern.

## Current security debt to close

1. Replace shared gateway bearer keys with scoped device/request authentication.
2. Stop treating caller context headers as authoritative without a signed/scoped Cloud assertion.
3. Define safe delivery of Bridge credentials; avoid reusable secrets in ordinary request headers where possible.
4. Rate-limit and size-limit gateway requests.
5. Define audit-safe error messages and diagnostics redaction.
6. Verify Cloudflare Access/Tunnel interaction and origin authentication.
