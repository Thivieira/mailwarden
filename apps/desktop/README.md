# Mailwarden Desktop Companion

The user-facing desktop companion for Mailwarden Bridge.

## Architecture & Technology Decision

### Selected Technology: Lightweight Desktop Shell & Companion Webview
1. **Direct TypeScript & Shared Contract Reuse**: Consumes `@mailwarden/contracts` and `@mailwarden/ui` directly without duplicating serialization schemas.
2. **Decoupled Daemon Boundary**: Does not bundle or own the Bridge Core daemon process lifecycle. Interacts with Claude's Bridge Core via local loopback IPC (`127.0.0.1:8765`).
3. **Multi-Platform Support**: Runs identically across macOS, Windows, and Linux with minimal binary overhead.
4. **Zero Cloud Database Direct Access**: Strictly consumes Cloud APIs and local Bridge interfaces. Never connects directly to D1.

## Key Views & Features
* **Workspace & Organization Context**: Displays active organization (e.g. `FoxDevStudio`) and current membership state.
* **Real-time Health Indicators**:
  * Relay Status (Online / Degraded / Offline)
  * Cloud Connection (Secure Tunnel active)
  * Proton Bridge Daemon (IMAP 1143 / SMTP 1025)
* **Team Accounts Roster**: Lists synchronized Proton accounts with sync status.
* **Diagnostics & Safe Repair**: 1-click self-test, bridge restart, and tunnel reconnection.

## Running Locally

```bash
bun run apps/desktop/src/index.ts
# Running at http://127.0.0.1:8790
```
