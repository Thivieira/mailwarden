# AlmaLinux reference platform

AlmaLinux/RHEL-compatible headless deployment is the first reference server path for the Proton relay. The current procedure is manual and is documented in [`docs/operations/ALMALINUX.md`](../../docs/operations/ALMALINUX.md).

The checked-in systemd units are reviewable templates, not an installer. A future Bridge installer must preserve the same service boundaries while adding safe provisioning, rollback, health checks, and secret storage.
