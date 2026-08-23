# Proton relay operations

## Normal health path

1. Proton Bridge is running and its loopback IMAP/SMTP endpoints accept the account credentials.
2. The Mailwarden Gateway is bound to loopback and `/v1/health` reports both endpoints reachable.
3. `cloudflared` reports at least one ready edge connection.
4. The Cloud heartbeat is fresh (stale after five minutes).
5. A read-only message search succeeds for each configured account.

`mailwarden-bridge status` reports exactly these components — `cloud`, `tunnel`,
`gateway`, `protonBridge`, `accounts`, `deviceIdentity` — and collapses them into one
relay status: `provisioning`, `online`, `degraded`, `offline`, or `needs_attention`.

## Diagnostic order

Check from the inside out:

```text
Proton account → Proton Bridge → loopback IMAP/SMTP → gateway → loopback HTTP → tunnel → Cloud API
```

`mailwarden-bridge doctor` does this walk and names the failing edge, with the
remediation class attached to each finding:

| Remediation | Meaning |
| --- | --- |
| `automatic` | `mailwarden-bridge repair <action>` fixes it |
| `user_action` | someone must run setup or approve the device |
| `proton_login` | Proton Bridge must be installed or signed in interactively |
| `administrator` | host-level change: package, port, network |

Do not rotate all secrets or reinstall Bridge before locating the failing edge.
Preserve logs and timestamps; Bridge logs redact tokens, passwords, and credentials,
and never contain message bodies.

## Repair actions

```bash
mailwarden-bridge repair restart_gateway       # restart the loopback gateway
mailwarden-bridge repair restart_tunnel        # restart cloudflared with the stored credential
mailwarden-bridge repair refresh_registration  # renew the device credential and tunnel credential
mailwarden-bridge repair recheck_proton        # re-run Proton Bridge discovery
mailwarden-bridge repair fix_permissions       # reset credential file to 0600
```

Repairs are deliberately non-destructive: none of them resets a Proton account,
deletes mail, or discards a credential that a human would have to re-authorize.

## Recovery rules

- **Bridge login expired:** repair the affected Proton account locally; do not change Mailwarden tenant IDs.
- **Device lost or compromised:** revoke the device in Mailwarden. On its next heartbeat the daemon
  erases its local credential, stops serving, and `status` explains why. Other devices are unaffected.
- **Credential rotation:** the daemon renews inside the last quarter of the credential's life, and applies
  a rotation Cloud returns with a heartbeat. A transient Cloud failure never discards a still-valid credential.
- **Tunnel token exposed:** rotate the tunnel token in Cloudflare and re-run `repair refresh_registration`.
  Mailwarden's Cloudflare account token is never on the device.
- **Legacy gateway key exposed:** rotate it in both relay and encrypted Cloud configuration, and register
  the device so it stops depending on the shared key.
- **Mailbox credential mismatch:** update only that mailbox's encrypted Bridge credentials.

Keep mailbox mutation disabled while recovering reads. Sending remains human-confirmed
even after relay recovery.
