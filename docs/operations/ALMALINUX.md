# AlmaLinux headless Proton relay

AlmaLinux/RHEL-compatible is Mailwarden's reference headless server. There are two
paths, and they share the same runtime:

- **Bridge-managed (current default).** `infra/almalinux/install-bridge.sh` installs
  the Mailwarden pieces, and `mailwarden-bridge` registers the device, runs the
  gateway, supervises the tunnel, and explains failures.
- **Manual reference.** The original three-service layout, kept for advanced
  administration, debugging, disaster recovery, and Bridge development.

Proton provides an RPM and notes that Red Hat derivatives can install it, but
currently lists Ubuntu LTS and Fedora as officially supported Linux distributions.
AlmaLinux compatibility is therefore owned and tested by Mailwarden, not guaranteed
by Proton. Proton Bridge also requires a paid Proton plan and a supported password
manager such as Pass or a Secret Service implementation. See
[Proton Bridge for Linux](https://proton.me/support/bridge-for-linux).

## What Mailwarden automates, and what it does not

| Step | Automated |
| --- | --- |
| Service user, directories, permissions | yes |
| Mailwarden Bridge systemd unit | yes |
| Device registration with Mailwarden Cloud | yes (`mailwarden-bridge setup`) |
| Proton Gateway lifecycle | yes (supervised inside the Bridge daemon) |
| Cloudflare Tunnel lifecycle | yes, when Cloud issued a scoped tunnel credential |
| Health, diagnostics, repair | yes (`status`, `doctor`, `repair`) |
| Proton Mail Bridge installation | **no** — install the official package |
| Proton account login | **no** — interactive, and it needs a working keyring |

Proton Bridge installation and login stay manual on purpose: Proton does not document
a supported headless login, and automating an unsupported path would fail in ways an
operator could not diagnose.

## Runtime

```text
systemd
├── proton-bridge.service      # official Proton Mail Bridge (loopback IMAP/SMTP)
└── mailwarden-bridge.service  # gateway + tunnel + heartbeat in one supervised process
```

One Mailwarden unit replaces the previous gateway-plus-cloudflared pair: the daemon
owns the gateway and starts `cloudflared` itself when Cloud has issued this device a
tunnel credential. A host that already runs its own `cloudflared` service keeps it —
Bridge detects an active unit and does not race it.

## Preconditions

- supported paid Proton account(s);
- current Proton Mail Bridge RPM from Proton, with the package signature verified;
- Bun installed at the path used by the unit;
- `pass`/GnuPG or another Bridge-supported password manager initialized for the service user;
- this repository installed at `/opt/mailwarden` (or `REPO_DIR` set);
- outbound HTTPS to Mailwarden Cloud and Cloudflare. No inbound port, no public IP.

Do not copy a version-pinned RPM URL from an old runbook. Use Proton's current
[RPM installation instructions](https://proton.me/support/installing-bridge-linux-rpm-file).

## Install

```bash
sudo REPO_DIR=/opt/mailwarden bash /opt/mailwarden/infra/almalinux/install-bridge.sh
```

The script prints every privileged command before running it. It creates the
`mailwarden` service user, `/etc/mailwarden` (0755) and `/var/lib/mailwarden` (0700),
writes a starting `bridge.json` with no secrets in it, and installs
`mailwarden-bridge.service`.

Then, as the service user:

```bash
sudo -u mailwarden MAILWARDEN_BRIDGE_CONFIG_DIR=/etc/mailwarden \
  MAILWARDEN_BRIDGE_STATE_DIR=/var/lib/mailwarden \
  bun run /opt/mailwarden/apps/bridge/src/cli.ts setup --cloud=https://<your-mailwarden-host>
sudo systemctl enable --now mailwarden-bridge
```

`setup` prints a short code and a URL. An organization owner approves the device in
the browser; the device then receives an organization-scoped, renewable credential.
No organization-wide bearer secret is ever copied to the machine.

## Verification

```bash
systemctl --no-pager --full status proton-bridge mailwarden-bridge
sudo -u mailwarden ... cli.ts status      # component health, one line each
sudo -u mailwarden ... cli.ts doctor      # explains any failure and who can fix it
```

`doctor --json` is the machine-readable form. Keep `MAILBOX_MUTATIONS_ENABLED=false`
during commissioning and verify a read-only search from Cloud before enabling more.

## Update

```bash
sudo systemctl stop mailwarden-bridge
sudo -u mailwarden git -C /opt/mailwarden pull   # or deploy the new checkout
sudo bash /opt/mailwarden/infra/almalinux/install-bridge.sh   # idempotent; refreshes the unit
sudo systemctl start mailwarden-bridge
```

Config is versioned: a Bridge that meets a config written by a newer Bridge refuses to
start rather than reinterpreting it. There is no automatic updater, by design — one
arrives only after signing, rollback, and interrupted-upgrade recovery are proven.

## Uninstall and recovery

```bash
sudo bash /opt/mailwarden/infra/almalinux/install-bridge.sh --uninstall
```

This removes the unit only. Device credentials in `/var/lib/mailwarden` and any Proton
Bridge installation and account data are left in place. To fully decommission a device,
revoke it in Mailwarden (which the daemon observes on its next heartbeat, erasing the
local credential) and then delete `/var/lib/mailwarden`.

## Known risks on this path

- Proton does not currently list AlmaLinux as an officially supported distribution.
- Headless Linux typically has no unlocked Secret Service, so Bridge credentials fall
  back to a 0600 file. `doctor` reports this rather than hiding it; protect the host
  accordingly (disk encryption, restricted accounts).
- Proton Bridge updates may require reinstalling the package; validate account/cache
  retention before scheduling unattended updates.
- The legacy `PROTON_GATEWAY_API_KEY` still authenticates the gateway for relays that
  predate device identity. It is deployment-wide and should be retired once the device
  is registered.
