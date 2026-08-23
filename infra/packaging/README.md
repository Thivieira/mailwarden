# Bridge packaging

**Current state:** Mailwarden Bridge runs from a checkout with Bun — `bun run bridge`
(CLI) and `bun run bridge:daemon` (service) — and installs as a systemd service through
`infra/almalinux/install-bridge.sh`. No signed package or standalone binary ships yet.

Platform support, stated factually:

| Target | Status |
| --- | --- |
| Linux x64 (source + systemd) | SUPPORTED |
| Linux arm64 | EXPERIMENTAL (same code path, unverified hardware) |
| macOS | PLANNED (needs launchd + Keychain adapters) |
| Windows | PLANNED (needs service + Credential Manager adapters) |

`bun build --compile` is the obvious next step for a single-file binary; it is not
claimed as working until it is built and the resulting binary is exercised by the same
`status`/`doctor` checks.

Every package must:

- install a daemon/service without embedding organization-wide bearer secrets;
- use native secret storage on desktop and the documented 0600 fallback on headless Linux;
- preserve existing Proton Bridge installations and accounts;
- support uninstall without deleting Proton data or device credentials by default;
- expose version, health, diagnostics, repair, and revocation state;
- verify upgrades and provide rollback before automatic updates are enabled.

Desktop technology remains open. Packaging decisions must compare service lifecycle,
updates, native secret stores, TypeScript reuse, binary size, and maintainability before
choosing Tauri, Electron, or another shell.
