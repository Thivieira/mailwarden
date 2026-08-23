# Cloudflare infrastructure

Mailwarden Cloud is deployed from the repository root with [`wrangler.jsonc`](../../wrangler.jsonc). The configuration deliberately stays at the root so `bun run deploy:dry`, `bun run deploy`, and `bun run ship` do not depend on an obscure working directory.

Current bindings:

- `DB`: production D1 database; migrations are read from `/migrations`.
- `MAILBOX_MUTATIONS_ENABLED=false`: production mailbox safety gate.
- `ALLOW_DEV_AUTH=false`: disables development authentication in the Worker.
- `KEY_VERSION=v1`: current encryption-key version label.
- cron: mailbox synchronization every 15 minutes.

OAuth credentials, authentication secrets, encryption keys, and future tunnel API credentials remain Cloudflare secrets. Do not add them to this directory.

Cloudflare Tunnel is currently configured outside this repository for the manual Proton relay. Managed tunnel provisioning is planned and must issue only scoped tunnel credentials to Bridge devices, never a Mailwarden account API token.
