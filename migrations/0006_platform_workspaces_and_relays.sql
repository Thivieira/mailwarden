ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'personal';--> statement-breakpoint

INSERT OR IGNORE INTO memberships (id, tenant_id, user_id, role, created_at)
SELECT 'legacy-personal-' || id, tenant_id, id, COALESCE(role, 'owner'), created_at
FROM users;--> statement-breakpoint

CREATE TABLE organization_invites (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);--> statement-breakpoint
CREATE INDEX organization_invites_tenant_idx ON organization_invites(tenant_id);--> statement-breakpoint
CREATE INDEX organization_invites_email_idx ON organization_invites(email);--> statement-breakpoint
CREATE INDEX organization_invites_expires_idx ON organization_invites(expires_at);--> statement-breakpoint

CREATE TABLE relay_devices (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'provisioning',
  capabilities TEXT NOT NULL,
  last_health TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);--> statement-breakpoint
CREATE INDEX relay_devices_tenant_idx ON relay_devices(tenant_id);--> statement-breakpoint
CREATE INDEX relay_devices_status_idx ON relay_devices(tenant_id, status);--> statement-breakpoint

CREATE TABLE relay_provisioning_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  authorized_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  relay_device_id TEXT REFERENCES relay_devices(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  authorized_at INTEGER,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);--> statement-breakpoint
CREATE INDEX relay_provisioning_tenant_idx ON relay_provisioning_sessions(tenant_id);--> statement-breakpoint
CREATE INDEX relay_provisioning_expires_idx ON relay_provisioning_sessions(expires_at);--> statement-breakpoint

CREATE TABLE relay_device_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1,
  device_secret_hash TEXT NOT NULL UNIQUE,
  encrypted_gateway_secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);--> statement-breakpoint
CREATE INDEX relay_credentials_device_idx ON relay_device_credentials(device_id);--> statement-breakpoint
CREATE INDEX relay_credentials_tenant_idx ON relay_device_credentials(tenant_id);
