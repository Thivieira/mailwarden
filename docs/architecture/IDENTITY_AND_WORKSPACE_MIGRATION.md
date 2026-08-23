# Identity and workspace migration decision

Status: **implemented additively in migrations `0006` and `0007`**. Production migrations have not been run.

## Read-only inventory

`users.id` is the identity referenced by every user-owned row. `users.tenant_id` is also present, but login already searches email globally and rejects duplicate/ambiguous identities. The safe evolution is therefore to keep each existing user ID and treat `users.tenant_id` as that identity's immutable Personal Workspace anchor.

| Area | Stored binding | Current authorization/compatibility consequence |
| --- | --- | --- |
| `users` / `identity_email_claims` | `id`, legacy `tenant_id`, normalized unique email claim | `id` becomes the global identity; legacy tenant/role remain Personal Workspace compatibility fields |
| `memberships` | `tenant_id`, `user_id`, role | canonical workspace authorization; migration backfills any missing personal membership |
| sessions, OAuth codes/tokens, stream tickets | `tenant_id`, `user_id` | already bind a credential to one workspace; token verification must recheck live membership |
| `user_auth_credentials` | `tenant_id`, unique `user_id` | login credential remains attached to the identity and its Personal Workspace anchor |
| email accounts, identities, provider connections | `tenant_id`, `user_id`, account IDs | tenant remains mailbox/workspace ownership; user remains connector/creator identity |
| emails, thread state, attachments, intelligence, policies | `tenant_id`, `user_id` | no row movement or ID rewrite is required |
| drafts, approvals, attempts, mailbox actions | `tenant_id`, `user_id`, resource IDs | existing human approval and idempotency bindings remain unchanged |
| provider OAuth state | signed `tenantId`, `userId` | callback must validate current membership before storing credentials |
| provider credential encryption | AAD `tenantId + userId` | both identifiers remain unchanged; existing ciphertext remains decryptable |
| MCP/API bearer JWTs | `sub=userId`, `tenantId`, session ID | legacy personal tokens continue; every token resolves exactly one workspace |
| human sessions | `userId`, `tenantId`, distinct audience | remain workspace-scoped and retain the human-send boundary |
| audit events | `tenant_id`, optional `user_id` | new organization/device events use the same workspace security boundary |
| `beta_invites` | private-beta code and user references | remains separate from `organization_invites` |
| `proton_connectors` | account/user/tenant and device token | preserved compatibility path; new organization relay devices use separate tables |

The existing `organizations` table remains contact intelligence. Team Organizations are `tenants.kind = 'team'`; no risky table rename is part of this migration.

## Decision

1. Preserve every existing user, tenant, mailbox, account, session, OAuth grant, provider connection, encrypted payload, and resource identifier.
2. Evolve `users.id` into the global identity without moving rows. Keep `users.tenant_id` as the Personal Workspace anchor until a future table rebuild can remove the legacy coupling safely.
3. Add `tenants.kind`, `status`, and `plan`. Existing tenants become active Personal Workspaces by default.
4. Make `memberships` the live authorization source. A signed tenant ID is a workspace selection, not proof of access.
5. Continue issuing workspace-scoped sessions/OAuth/MCP tokens. Switching workspaces issues a new scoped token after membership validation.
6. Store Team Organization invites and relay devices in new tables. Never reuse private-beta invites or contact-intelligence organizations.

This deliberately makes Personal Workspaces non-deletable identity anchors for now: the legacy foreign key would cascade-delete the global identity. No current product route deletes a tenant. Removing that coupling later requires a reviewed SQLite table rebuild, not an opportunistic rename.

## Migration behavior

Migration `0006`:

- adds only defaulted tenant metadata columns;
- inserts missing Personal Workspace owner memberships with `INSERT OR IGNORE`;
- creates organization-invite and relay-device/provisioning/credential tables;
- does not rewrite identifiers, encrypted values, OAuth records, sessions, or mailbox data.

Migration `0007` atomically reserves normalized email addresses for new global identities and backfills existing users without rewriting them. This closes concurrent duplicate-signup creation while retaining the existing ambiguous-login failure for any historical duplicate that requires manual resolution.

Before a remote migration, run read-only checks for duplicate normalized user emails, missing personal memberships, and invalid tenant/user foreign-key pairs. A duplicate email blocks organization invite acceptance and must be resolved explicitly; the migration intentionally does not add a global email unique index that could fail an existing production database.

```sql
SELECT lower(email) AS normalized_email, count(*) AS identities
FROM users
GROUP BY lower(email)
HAVING count(*) > 1;

SELECT u.id, u.tenant_id, u.email
FROM users u
LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
WHERE m.id IS NULL;

PRAGMA foreign_key_check;
```

Rollback is application rollback plus leaving additive columns/tables unused. Dropping populated tables is not a safe production rollback.
