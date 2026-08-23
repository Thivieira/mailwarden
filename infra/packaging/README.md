# Bridge packaging constraints

**PLANNED.** No installer or package is shipped yet. Packaging work belongs here once Bridge has a standalone core and provisioning protocol.

Every package must:

- install a daemon/service without embedding organization-wide bearer secrets;
- use native secret storage on desktop and a documented encrypted alternative on headless Linux;
- preserve existing Proton Bridge installations and accounts;
- support uninstall without deleting Proton data by default;
- expose version, health, diagnostics, repair, and revocation state;
- verify upgrades and provide rollback before automatic updates are enabled.

Desktop technology remains open. Packaging decisions must compare service lifecycle, updates, native secret stores, TypeScript reuse, binary size, and maintainability before choosing Tauri, Electron, or another shell.
