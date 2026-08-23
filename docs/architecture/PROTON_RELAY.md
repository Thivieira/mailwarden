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

The gateway exposes `/v1/health`, search, message/thread, mutation, draft, and send.
A configured gateway URL normally includes the `/v1` prefix. Non-local gateway URLs
must use HTTPS, and known metadata endpoints are rejected.

Cloud sends per-request caller context:

- `X-Tenant-Id`, `X-User-Id`, `X-Account-Id` (shape-validated by the gateway)
- optional `X-Proton-Username` / `X-Proton-Password` for per-account selection

Authentication has three modes, in descending order of preference:

| Mode | Credential | Status |
| --- | --- | --- |
| `device-signature` | HMAC-SHA256 over `v1\n{protocol}\n{METHOD}\n{path}\n{timestamp}\n{sha256(body)}` with the device's `gatewaySecret`, sent as `X-Mailwarden-Signature: v1=…` plus `X-Mailwarden-Timestamp` | implemented in the gateway and exported from `@mailwarden/relay`; Cloud adoption pending |
| `device-token` | `Authorization: Bearer <gatewaySecret>` — per device, rotatable, revocable | implemented; Cloud adopts it by storing the device secret instead of the shared key |
| `legacy-shared-key` | `Authorization: Bearer <PROTON_GATEWAY_API_KEY>` | compatibility only; logged as a warning on every request |

Signed requests are bound to a ±300s window and each signature is accepted once, so a
captured request cannot be replayed. Requests are size-limited (1 MiB by default) and
rate-limited per minute. Errors are generic; detail stays in redacted local logs.

Per-request Bridge credentials allow one Bridge/gateway host to serve multiple
logged-in Proton accounts. This is implemented, but capacity, account limits, official
support, and failure isolation have not been qualified; do not describe it as unlimited.

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

1. **Closed for registered devices:** the gateway accepts per-device credentials with
   replay protection; the deployment-wide key remains only as a compatibility mode.
2. Caller context headers are shape-validated but still not signed by Cloud; the signed
   request mode covers the whole request, and adopting it in Cloud closes this.
3. Bridge credentials still travel as request headers. Delivering them out of band, or
   letting the device resolve them locally, is the next step.
4. **Closed:** gateway requests are size- and rate-limited.
5. **Closed:** logs redact credentials and errors are generic; diagnostics carry no secrets.
6. Cloudflare Access/Tunnel origin authentication still needs verification against a real
   managed tunnel.
