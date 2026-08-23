# Cloudflare infrastructure

Mailwarden Cloud is deployed from the repository root with [`wrangler.jsonc`](../../wrangler.jsonc).
The configuration deliberately stays at the root so `bun run deploy:dry`, `bun run deploy`,
and `bun run ship` do not depend on an obscure working directory.

Current bindings:

- `DB`: production D1 database; migrations are read from `/migrations`.
- `MAILBOX_MUTATIONS_ENABLED=false`: production mailbox safety gate.
- `ALLOW_DEV_AUTH=false`: disables development authentication in the Worker.
- `KEY_VERSION=v1`: current encryption-key version label.
- cron: mailbox synchronization every 15 minutes.

OAuth credentials, authentication secrets, encryption keys, and tunnel API credentials
remain Cloudflare secrets. Do not add them to this directory.

## Managed tunnels

The device side is implemented in `apps/bridge/src/core/tunnel.ts`: Bridge discovers
`cloudflared`, starts it with the scoped credential Cloud issued for that device, and
reads readiness from the local metrics endpoint.

The Cloud side is Platform's: it provisions the tunnel with Mailwarden's own Cloudflare
account token and returns only a `RelayTunnelCredential` — tunnel id, hostname, and the
`cloudflared` run token — for that one device. The account API token must never reach a
customer host. Bridge passes the run token through the `TUNNEL_TOKEN` environment
variable rather than `--token`, because argv is readable by every user via `ps`.

Until those endpoints exist, Bridge uses a development adapter that issues throwaway
tunnel credentials; a real `cloudflareBaseUrl`-backed client replaces it with no change
to the device lifecycle.
