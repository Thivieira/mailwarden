# AlmaLinux headless Proton relay

This is Mailwarden's **manual reference deployment**, useful for advanced administrators, debugging, disaster recovery, and Bridge development. It is not the future customer installer.

Proton provides an RPM and notes that Red Hat derivatives can install it, but currently lists Ubuntu LTS and Fedora as officially supported Linux distributions. AlmaLinux compatibility is therefore owned and tested by Mailwarden, not guaranteed by Proton. Proton Bridge also requires a paid Proton plan and a supported password manager such as Pass or a Secret Service implementation. See [Proton Bridge for Linux](https://proton.me/support/bridge-for-linux).

## Runtime

```text
systemd
├── proton-bridge.service
├── mailwarden-gateway.service
└── cloudflared.service
```

All three services run on the customer-controlled server. Proton Bridge and the Mailwarden Gateway bind to loopback. `cloudflared` creates outbound connections to Cloudflare; no inbound firewall port or public IP is required. See [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/).

## Preconditions

- supported paid Proton account(s);
- current Proton Mail Bridge RPM downloaded from Proton and package signature verified;
- Bun installed at the path used by the service unit;
- `pass`/GnuPG or another Bridge-supported password manager initialized for the service user;
- a dedicated unprivileged `mailwarden` user with persistent home `/var/lib/mailwarden`;
- this repository installed at `/opt/mailwarden` or the unit adjusted;
- a Cloudflare Tunnel and published hostname routed to `http://localhost:8080`;
- generated, high-entropy gateway API key stored outside Git.

Do not copy a version-pinned RPM URL from an old runbook. Use Proton's current [RPM installation instructions](https://proton.me/support/installing-bridge-linux-rpm-file) and verification guidance.

## Manual setup outline

1. Install Proton Bridge, Bun, `pass`, and GnuPG.
2. Create the `mailwarden` service account and initialize its GPG/Pass keyring.
3. Run Proton Bridge interactively as `mailwarden`; sign in each paid account and record each account's Bridge-generated IMAP credentials in an approved secret store.
4. Verify Bridge listens only on loopback and confirm its current IMAP/SMTP ports and STARTTLS settings. Do not assume the example ports if Bridge reports different values.
5. Create `/etc/mailwarden/bridge.env` owned by root, group-readable only by the service group, mode `0640` or stricter:

   ```text
   PROTON_GATEWAY_API_KEY=<random secret>
   PROTON_BRIDGE_HOST=127.0.0.1
   PROTON_BRIDGE_IMAP_PORT=<reported IMAP port>
   PROTON_BRIDGE_SMTP_PORT=<reported SMTP port>
   PORT=8080
   ```

   Per-account mode does not place Bridge usernames/passwords in this shared file; Cloud currently supplies encrypted per-mailbox credentials to the authenticated gateway request.

6. Review and install the templates from `/infra/systemd`; adjust executable paths and service user to the real host.
7. Install `cloudflared` using Cloudflare's documented service workflow and configure the tunnel to the loopback gateway. Cloudflare documents `cloudflared service install <TUNNEL_TOKEN>`; keep the token out of shell history where operational tooling permits. See [Tunnel setup](https://developers.cloudflare.com/tunnel/setup/).
8. Enable services in dependency order and inspect their logs for secret leakage before connecting Cloud.

## Verification

From the relay host:

```bash
systemctl --no-pager --full status proton-bridge mailwarden-gateway cloudflared
curl -fsS -H "Authorization: Bearer $PROTON_GATEWAY_API_KEY" http://127.0.0.1:8080/v1/health
```

Then verify the tunnel hostname over HTTPS with the same authorization header. Do not paste the real key into tickets or shared terminal recordings.

Finally use Mailwarden's connector status and a read-only mailbox search. Keep `MAILBOX_MUTATIONS_ENABLED=false` during commissioning.

## Known manual-path risks

- Proton does not currently list AlmaLinux as an officially supported distribution.
- Headless CLI flags and automation are not yet covered by a Mailwarden compatibility matrix.
- The checked-in service units are templates and have not been packaged or installed automatically.
- The current gateway bearer key is deployment-wide and must be replaced by scoped device identity for productized Bridge.
- Updating Proton Bridge may require reinstalling the current package; validate account/cache retention and rollback before scheduling unattended updates.
