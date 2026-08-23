# Sol Platform handoff

Point in time: 2026-08-23. Production is **not deployed or migrated**.

## Implemented

- Existing `users.id` is now the global identity; `users.tenant_id` remains the immutable Personal Workspace compatibility anchor.
- `memberships` is the live workspace authorization source for API, portal session, OAuth, provider OAuth, human session, stream ticket, and MCP token verification.
- Existing Personal Workspace tokens remain valid after membership backfill; removed membership invalidates stored sessions and OAuth refresh tokens immediately.
- Active workspace tokens carry both `workspaceId` and transitional `tenantId`; switching issues a new workspace-scoped token.
- Team Organization creation, listing, member listing, role changes, member removal, invite creation/list/revoke/accept, and new-user invite signup continuation are D1-backed.
- Organization invite tokens are random, hashed at rest, optionally email-locked, expiring, revocable, and single-use with same-user retry recovery.
- Team mailbox listing and provider lookup are workspace-scoped. Provider credentials continue decrypting with the original connector user's unchanged AAD.
- Central Personal/Team/Enterprise capability resolution and server-side organization/seat/relay quotas are implemented without billing.
- Relay provisioning start, human authorization, device registration, one-time per-device credentials, heartbeat, list, revoke, rotate, and encrypted Cloud-held gateway secret are D1-backed.
- MCP exposes `get_active_workspace` and `list_workspaces`; every authenticated MCP bearer still resolves exactly one workspace and never aggregates implicitly.
- Gemini's production-path in-memory organization/device mocks were replaced with adapters over canonical Platform services. Bridge repair reports unavailable until a real Bridge control endpoint exists.

## Schema changes

### Migration `0006_platform_workspaces_and_relays.sql`

- `tenants.kind`: `personal | team`, default `personal`.
- `tenants.status`: `active | suspended`, default `active`.
- `tenants.plan`: `personal | team | enterprise`, default `personal`.
- backfills missing existing personal owner memberships with `INSERT OR IGNORE`.
- adds `organization_invites`.
- adds `relay_devices`.
- adds `relay_provisioning_sessions`.
- adds `relay_device_credentials`.

### Migration `0007_global_identity_email_claims.sql`

- adds `identity_email_claims(email PRIMARY KEY, user_id UNIQUE REFERENCES users ON DELETE CASCADE, created_at)`.
- backfills normalized existing email claims.
- new identity creation reserves the email atomically before creating the Personal Workspace and cleans the claim on rollback.

No existing user, tenant, mailbox, provider connection, encrypted value, session, OAuth record, MCP credential, policy, message, or audit identifier moves. See `docs/architecture/IDENTITY_AND_WORKSPACE_MIGRATION.md`.

## Contracts changed

- `WorkspaceKind`: `personal | team`.
- `Workspace`: slug, status, plan, created timestamp.
- `Membership`: created timestamp.
- `OrganizationInvite`: optional email lock and created timestamp.
- `PlanCapabilities`: organization count, seats, mailboxes, relay devices, shared relay, SSO.
- `RelayDevice`: protocol version and revocation timestamp.
- `RelayDevice.health`: optional latest canonical `BridgeHealth` snapshot for Cloud/Product status.
- `RelayProvisioningStartRequest`: optional protocol version.
- Claude's Bridge health, device credential, tunnel, diagnostics, and repair contracts were preserved.

## APIs added

All user endpoints require a normal workspace bearer and revalidate membership.

- `GET /api/workspaces`
- `GET /api/workspaces/current`
- `POST /api/workspaces/:workspaceId/select`
- `POST /api/organizations`
- `GET /api/organizations/:workspaceId/members`
- `PATCH|DELETE /api/organizations/:workspaceId/members/:userId`
- `GET|POST /api/organizations/:workspaceId/invites`
- `DELETE /api/organizations/:workspaceId/invites/:inviteId`
- `POST /api/organization-invites/accept`
- `GET /api/workspaces/:workspaceId/mailboxes`
- `POST /api/relay/provisioning/start`
- `POST /api/relay/provisioning/authorize`
- `POST /api/relay/provisioning/poll`
- `POST /api/relay/heartbeat`
- `POST /api/bridge/v1/provisioning/start`
- `POST /api/bridge/v1/provisioning/poll`
- `POST /api/bridge/v1/devices/heartbeat`
- `POST /api/bridge/v1/devices/credential/renew`
- `POST /api/bridge/v1/devices/tunnel` (authenticated `404` until managed allocation exists)
- `GET /api/organizations/:workspaceId/relay-devices`
- `DELETE /api/organizations/:workspaceId/relay-devices/:deviceId`
- `POST /api/organizations/:workspaceId/relay-devices/:deviceId/rotate-credential`

Provider/MCP OAuth authorization accepts optional `workspace_id`, stores it in the authorization code/refresh token, and preserves it through refresh. Password login still defaults to Personal Workspace.

## Important decisions

- Team Organizations are tenants with `kind=team`; the existing contact-intelligence `organizations` table is untouched.
- Private-beta and Team Organization invite tables/flows remain separate. A valid organization invitation may continue signup without becoming a beta invite.
- `users.tenant_id` cannot be removed or changed yet because existing FKs, login credentials, and encryption AAD depend on stable identities. Personal Workspace deletion remains unsupported.
- Workspace identifiers select context; only a live membership grants access.
- Relay `deviceSecret` is hashed. The separate per-device `gatewaySecret` is envelope-encrypted with tenant-bound AAD for future Cloud-to-gateway calls.
- Provisioning credential delivery is one-time. A lost response requires reprovisioning; plaintext secrets are never persisted for recovery.

## Requests for Claude

- `HttpCloudClient` now matches the versioned Platform endpoints and heartbeat envelope; run a real local HTTP interoperability test next.
- Use the device authorization flow and `BridgeHealth` heartbeat contract from `@mailwarden/contracts`.
- Persist `deviceSecret` and `gatewaySecret` only in the Bridge secret store.
- On `RelayHeartbeatResponse.state=revoked`, erase credentials and stop relaying.
- Replace the legacy deployment-wide gateway bearer with the per-device `gatewaySecret`; Platform preserves the old gateway path until that lands.
- The gateway's signed-request format is canonical in `@mailwarden/relay`; Cloud still needs to adopt it when mailbox routing through registered devices lands.

## Requests for Gemini

- Consume the `/api/workspaces`, organization/member/invite, and relay-device endpoints; do not recreate persistence in portal services.
- Workspace switching should use `POST /api/workspaces/:id/select` and the returned cookie/token, not trust `?ws=` by itself.
- Carry `organizationInviteToken` through signup when the URL contains `organization_invite`.
- Keep repair disabled/unavailable until Claude exposes a real control endpoint; do not display simulated success.
- Treat `team` as the canonical workspace kind.

## Known gaps

- MCP OAuth can bind `workspace_id`, but the authorization page does not yet render a workspace picker.
- Core email reads/provider lookup support team-shared mailboxes; some attention/waiting/policy intelligence remains creator-user scoped and needs a deliberate shared-workspace pass.
- No organization ownership-transfer workflow beyond adding another owner then demoting/removing the old owner.
- No invite email sender; the API returns a one-time invite URL.
- No relay provisioning denial endpoint, public-start rate limiter/cleanup cron, managed Cloudflare Tunnel allocation, or Cloud-to-gateway signed request implementation.
- The legacy Proton gateway still accepts its existing shared bearer for compatibility.
- Production migrations and deployment were not run.

## Tests and integration

Platform tests: `tests/platform_security.test.ts`. Product integration coverage: `tests/portal_and_organizations.test.ts`. Migration tests run all migrations against a temporary empty SQLite database and remove it afterward.

Final local gate: 227 tests passing with 732 expectations across 30 files; strict typecheck passes; Wrangler dry-run builds successfully with D1 resolved and `MAILBOX_MUTATIONS_ENABLED=false`.

Before integration:

```bash
bun run db:migrate
bun test
bun run typecheck
bun run build
git diff --check
```

Apply remote D1 migrations before deploying code that reads the new columns/tables. Run the documented duplicate-email and membership preflight first. Do not deploy with mailbox mutations enabled.
