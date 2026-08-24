-- Managed Cloudflare Tunnel allocation per relay device.
--
-- Mailwarden Cloud provisions a dedicated tunnel with its own Cloudflare account
-- token and hands the device only that tunnel's run token. The run token is
-- deliberately not stored here: it is fetched from Cloudflare on demand, so a
-- database copy of this table carries no credential that can connect a tunnel.
ALTER TABLE relay_devices ADD COLUMN tunnel_id TEXT;
--> statement-breakpoint
ALTER TABLE relay_devices ADD COLUMN tunnel_hostname TEXT;
--> statement-breakpoint
ALTER TABLE relay_devices ADD COLUMN tunnel_provisioned_at INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS relay_devices_tunnel_hostname_idx ON relay_devices(tunnel_hostname);
