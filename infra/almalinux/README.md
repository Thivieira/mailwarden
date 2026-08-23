# AlmaLinux reference platform

AlmaLinux/RHEL-compatible headless is Mailwarden's reference server path. Proton does
not list AlmaLinux as an officially supported distribution, so this compatibility is
Mailwarden-owned and Mailwarden-tested.

- `install-bridge.sh` — installs the Mailwarden pieces (service user, directories,
  config, systemd unit) and prints every privileged command before running it.
  `--uninstall` removes the unit and leaves credentials and Proton data in place.
- Proton Mail Bridge installation and Proton account login stay manual: Proton does not
  document a supported headless login, and automating an unsupported path fails in ways
  an operator cannot diagnose.

The full procedure, including verification, update, and recovery, is in
[`docs/operations/ALMALINUX.md`](../../docs/operations/ALMALINUX.md).

Platform support, stated factually:

| Platform | Status | Notes |
| --- | --- | --- |
| Linux x64 (AlmaLinux/RHEL, Ubuntu) | SUPPORTED | Bridge Core, daemon, CLI, systemd, tunnel verified on Linux x64 |
| Linux arm64 | EXPERIMENTAL | Same code path; not yet exercised on arm64 hardware |
| macOS | PLANNED | Needs a launchd adapter and Keychain secret store |
| Windows | PLANNED | Needs a service adapter and Credential Manager secret store |
