# systemd templates

These templates preserve the current three-service relay boundary:

1. `proton-bridge.service` decrypts mail locally and exposes loopback IMAP/SMTP.
2. `mailwarden-gateway.service` exposes the authenticated Mailwarden HTTP gateway on loopback.
3. `cloudflared.service` is installed and owned by the official `cloudflared service install` workflow, so no duplicate unit is checked in here.

Copying the files is not sufficient. Create the unprivileged `mailwarden` service account, initialize Proton Bridge and its keyring as that user, place a root-readable `0600` environment file at `/etc/mailwarden/bridge.env`, and follow [`docs/operations/ALMALINUX.md`](../../docs/operations/ALMALINUX.md).

Never put `PROTON_GATEWAY_API_KEY`, Bridge-generated passwords, or tunnel credentials in a unit file or Git.
