# Proton relay operations

## Normal health path

1. Proton Bridge is running and its local IMAP/SMTP endpoints accept the configured account credentials.
2. Mailwarden Gateway is bound to loopback and `/v1/health` succeeds with authentication.
3. `cloudflared` reports a healthy tunnel.
4. Cloud connector heartbeat is fresh.
5. A read-only message search succeeds for each configured account.

The current Cloud connector considers a heartbeat stale after five minutes. Shared relay contracts reserve richer `provisioning`, `online`, `degraded`, `offline`, and `needs_attention` states for future Bridge devices.

## Diagnostic order

Check from the inside out:

```text
Proton account → Proton Bridge → loopback IMAP/SMTP → gateway → loopback HTTP → tunnel → Cloud API
```

Do not rotate all secrets or reinstall Bridge before locating the failing edge. Preserve service logs and timestamps, but redact tokens, passwords, message bodies, and request headers.

## Recovery rules

- Bridge login expired: repair the affected Proton account locally; do not change Mailwarden tenant IDs.
- Gateway key exposed: rotate the gateway key in both relay and encrypted Cloud configuration; invalidate old access.
- Tunnel token exposed: rotate the tunnel token/device credential in Cloudflare; do not expose the Cloudflare account API token.
- Device lost: the current shared-key design lacks independent device revocation. Disable its tunnel and gateway access immediately; future Bridge devices will support direct revocation.
- Mailbox credential mismatch: update only that mailbox's encrypted Bridge credentials.

Keep mailbox mutation disabled while recovering reads. Sending remains human-confirmed even after relay recovery.
