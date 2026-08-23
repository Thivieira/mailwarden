# Organizations and Proton architecture: proposal status record

This document preserves the intent of the original combined proposal while correcting its implementation claims. The maintained architecture is now split across:

- [Organizations](architecture/ORGANIZATIONS.md)
- [Mailwarden Bridge](architecture/MAILWARDEN_BRIDGE.md)
- [Proton relay](architecture/PROTON_RELAY.md)
- [Security](architecture/SECURITY.md)
- [AlmaLinux operations](operations/ALMALINUX.md)

## Implemented

- personal tenant/vault creation;
- `users`, `tenants`, and owner `memberships` records;
- tenant/user-scoped mailbox, message, credential, policy, draft, approval, and audit data;
- Gmail and Microsoft provider/OAuth code paths;
- Proton provider adapter and authenticated Proton Gateway;
- per-request Proton Bridge account credentials for dynamic account selection;
- Proton connector registration, hashed connector token, heartbeat, and status;
- encrypted provider credentials;
- private-beta signup invites;
- Cloudflare Worker/D1 deployment and cron synchronization;
- human-confirmed sending and mailbox dry-run safety.

## Partial

- a personal tenant can become a Personal Workspace, but no workspace-kind migration exists;
- memberships exist but are not the source of route authorization;
- the gateway can serve multiple configured Bridge accounts, but uses a deployment-wide bearer key;
- the manual Tunnel/Gateway/Bridge path exists, but no productized Bridge installer or daemon exists;
- the source includes an `organizations` table, but it describes sender/contact intelligence, not Team Organizations.

## Planned only

- global user identity belonging to multiple workspaces;
- Team Organization lifecycle, members, roles, and organization invites;
- active workspace in portal and MCP;
- organization-owned mailboxes and relay inheritance;
- plan capabilities, seats, and quotas;
- independent RelayDevice registration/revocation/rotation;
- short-lived device provisioning and renewable scoped credentials;
- Mailwarden-managed Cloudflare Tunnel creation and relay namespace;
- Bridge Core, daemon, CLI, desktop UI, installers, diagnostics, repair, and automatic updates;
- multiple-relay selection/failover;
- billing, SSO, SCIM, custom domains, and high availability.

## Corrections to the original proposal

- Private-beta invites are not organization invites.
- A user cannot currently switch among Personal and Team workspaces; tokens bind one tenant.
- Current `memberships` do not enforce organization roles.
- Shared relay inheritance is not implemented.
- Current connector records are per account, not organization relay devices.
- The current gateway secret is not the desired future device identity.
- AlmaLinux is Mailwarden's reference deployment, but Proton currently names Ubuntu LTS and Fedora as officially supported Linux distributions.
- No pricing, seat quota, unlimited mailbox, D1 sharding, SAML, or HA behavior is shipped.

## Preserved architectural direction

One Mailwarden repository owns Cloud, Bridge, Desktop, contracts, D1 schema/migrations, infrastructure, tests, and documentation. Team Organizations evolve existing tenants. Only Cloud accesses D1. Proton continues through official Proton Bridge and customer-controlled infrastructure. Cloudflare Tunnel remains a first-class relay component. Mailwarden should hide that complexity from normal customers.
