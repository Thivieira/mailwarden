# Mailwarden Bridge

Mailwarden Bridge is the customer-controlled runtime between Mailwarden Cloud and Proton Mail. Its product principle is simple:

```text
Install Mailwarden Bridge → Sign in → Choose organization → Connect Proton → Done
```

IMAP, SMTP, STARTTLS, gateway credentials, cloudflared, ports, systemd, and keyrings belong in diagnostics and operations—not the normal onboarding path.

## Current implementation

**PARTIAL:**

- `apps/bridge/src/gateway.ts` is the executable entrypoint.
- The existing Hono Proton Gateway implementation remains at `src/services/proton-gateway.ts` during the transition.
- The gateway reads/searches/mutates/drafts/sends through loopback Proton Bridge IMAP/SMTP.
- One gateway process can select per-request Bridge username/password credentials.
- Cloud has per-account connector registration, hashed device tokens, heartbeat, and status endpoints.
- AlmaLinux/systemd reference files exist under `/infra`.

Current limitations:

- the gateway uses one long-lived `PROTON_GATEWAY_API_KEY` for all requests;
- Cloud sends Bridge-generated credentials in authenticated HTTPS request headers;
- connectors are attached to one account/user, not independent organization relay devices;
- there is no standalone daemon state machine, CLI, installer, tunnel provisioner, revocation channel, secret-store abstraction, update mechanism, or desktop UI;
- the gateway still imports transitional Cloud utilities and has not been extracted into a standalone Bridge Core.

## Near-term Bridge Core

Claude Opus 5 should establish one reusable core behind daemon and CLI entrypoints:

1. local configuration with schema/versioning;
2. secret-store interface with one verified headless Linux implementation;
3. Cloud authentication and short-lived device provisioning;
4. organization selection and relay registration;
5. device credential renewal, rotation, and revocation awareness;
6. Proton Bridge discovery and explicit compatibility reporting;
7. gateway lifecycle and loopback-only binding;
8. Cloudflare Tunnel lifecycle using scoped tunnel credentials;
9. heartbeat, health state, diagnostics, and repair actions;
10. service install/uninstall with rollback.

The first slice should not automate Proton login or package installation until official interfaces and failure behavior are verified.

## Future architecture

```text
Bridge Core
├── daemon / Windows service / macOS launch daemon / systemd service
├── CLI
├── desktop shell
├── Cloud client
├── device identity and local secret storage
├── Proton Bridge adapter
├── Proton Gateway
├── Cloudflare Tunnel adapter
└── health / diagnostics / repair
```

Platform targets are Windows, macOS, Linux Desktop, and Linux Headless. They share Bridge Core; platform adapters own service management, secret storage, and installation details.

## Device identity and provisioning

**PLANNED:** a browser authorization produces a short-lived provisioning credential. After organization approval, the device receives renewable, organization-scoped credentials. Each device can be registered, rotated, revoked, audited, and health checked independently.

Never copy one permanent organization bearer secret to every machine. A lost device must be revocable without rotating every relay.

## Cloudflare Tunnel

Cloudflare Tunnel is a product component because it provides outbound-only connectivity without public inbound ports or public IPs. Managed provisioning should allocate a Mailwarden-controlled relay hostname and deliver only the tunnel credential needed by that device. Customers must never receive Mailwarden's Cloudflare account API token.

## Proton Bridge integration

Mailwarden will integrate with official Proton Mail Bridge rather than reimplement Proton's cryptography. Proton documents Bridge as a local IMAP/SMTP service and requires a paid Proton plan. Linux also requires a supported password manager. Automation questions that still need verification include CLI stability, headless account login, lifecycle control, update semantics, license/support limits, and safe retrieval of per-account Bridge credentials.

## Secrets

Desktop targets should use Windows Credential Manager, macOS Keychain, and Linux Secret Service where available. Headless Linux needs an explicit encrypted/keyring-backed design. Plaintext secrets in Git, unit files, command arguments, diagnostics bundles, or logs are prohibited.

## Health model

Shared contracts define `provisioning`, `online`, `degraded`, `offline`, and `needs_attention`. A heartbeat may report gateway reachability, Proton Bridge reachability, tunnel state, version, connected account count, and last successful request. The current connector status values are narrower and must not be silently treated as the final protocol.

## Desktop and updates

Desktop technology remains open. Compare background-service support, Windows services, macOS daemons, systemd, updater safety, native secrets, UI quality, TypeScript reuse, binary size, and maintainability before selection.

Automatic updates remain planned. Do not enable them until packages are signed, rollback is proven, data/config compatibility is versioned, and interrupted upgrades are recoverable.
