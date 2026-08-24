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

## Managed relay tunnels

Mailwarden provisions a dedicated Cloudflare Tunnel per relay device. Cloud holds
the Cloudflare account token; a device receives only its own tunnel's run token,
which can connect that one tunnel and nothing else. Deleting the tunnel takes the
device offline without touching any other relay.

```text
device asks Cloud for its tunnel
  → Cloud creates a remotely-managed tunnel      POST /accounts/{account}/cfd_tunnel
  → points its ingress at the device's loopback  PUT  …/cfd_tunnel/{id}/configurations
  → publishes a hostname                         POST /zones/{zone}/dns_records (CNAME → {id}.cfargotunnel.com)
  → returns the run token                        GET  …/cfd_tunnel/{id}/token
  → device runs cloudflared with TUNNEL_TOKEN
```

The run token is **not stored** in D1. It is fetched from Cloudflare each time the
device asks, so a copy of the database contains nothing that can connect a tunnel.

### Configuration

Managed allocation stays off until all four settings exist. Without them the
endpoint returns an authenticated `404` and relays keep using an operator-run
tunnel — nothing is faked.

| Setting | Kind | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_TUNNEL_API_TOKEN` | Worker **secret** | Account token. Never leaves Cloud. |
| `CLOUDFLARE_TUNNEL_ACCOUNT_ID` | var | Account that owns the tunnels |
| `CLOUDFLARE_TUNNEL_ZONE_ID` | var | Zone holding the relay hostnames |
| `RELAY_HOSTNAME_SUFFIX` | var | e.g. `relay.mailwarden.app` |

```bash
bunx wrangler secret put CLOUDFLARE_TUNNEL_API_TOKEN
# then add the three non-secret values to wrangler.jsonc `vars`
```

The API token needs exactly two permissions:

- **Account · Cloudflare Tunnel · Edit** — create, configure, read the token for, and delete tunnels
- **Zone · DNS · Edit** on the relay zone — publish and remove the CNAME

Scope it to the one account and the one zone. Do not reuse the deploy token.

### Safety properties

- A device may only ask for a **loopback** service to be published. A tunnel
  pointed at a LAN address would turn a Mailwarden hostname into a pivot into the
  customer's private network, so that request is rejected before it reaches Cloudflare.
- Ingress is re-applied whenever the device asks, so a changed gateway port heals itself.
- A failed setup deletes the tunnel it just created rather than leaking an orphan.
- Revoking a device deletes its tunnel and its DNS record. If Cloudflare is
  unreachable, revocation still completes locally and the failure is recorded.
- Hostnames are derived from the device id, normalized to a legal DNS label, and
  held unique by a database index.

OAuth credentials, authentication secrets, and encryption keys remain Cloudflare
secrets. Do not add them to this directory.
