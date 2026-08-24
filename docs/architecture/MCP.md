# MCP architecture

## Current implementation

**SHIPPED:** Mailwarden exposes MCP over streamable HTTP, JSON-RPC, and SSE-compatible routes. Bearer/OAuth authentication resolves one global `userId` and one active `workspaceId`/transitional `tenantId`, permission scopes, live membership/role, and session metadata. Tools cover inbox status, attention, waiting states, search/read, drafts, human-approved sending, policies, relationships, onboarding, synchronization, privacy, workspace context, and settings UI resources.

MCP clients never receive provider credentials. Tool services query stored data and provider adapters on the server side. Mutation and send scopes are enforced in code; sending still requires a separate human approval flow.

Inbox intelligence uses MCP as its semantic execution boundary; MailScribe core
does not call a model. See [INBOX_INTELLIGENCE.md](./INBOX_INTELLIGENCE.md) and
[MCP_TRIAGE_PROTOCOL.md](./MCP_TRIAGE_PROTOCOL.md) for the event context, external
judgment, validation, persistence, priority, and correction workflow.

## Current workspace behavior

The principal's single tenant is the effective workspace. Token verification rechecks membership, and the `get_active_workspace` and `list_workspaces` tools expose context without combining mail. Existing personal credentials remain scoped to their original Personal Workspace.

## Workspace selection

Every MCP session/token resolves exactly one `WorkspaceContext`. Current selection paths are:

- legacy/password login defaults to Personal Workspace;
- OAuth authorization accepts an optional `workspace_id` and binds it through code exchange and refresh;
- the Platform workspace-selection API issues a new scoped token.

Do not accept an arbitrary `tenantId` tool argument as authorization. Search, attention, waiting, inbox status, mailbox actions, drafts, policies, and settings all use the resolved workspace.

## Contract ownership

`packages/contracts` owns `WorkspaceContext` and mailbox/provider protocol types. GPT-5.6 Sol owns final MCP workspace semantics and any schema/migration changes. Product UI may request workspace-selection fields; Bridge may request relay context fields; neither should redefine the canonical contract locally.

## Compatibility

Existing personal bearer and OAuth credentials continue to resolve their current tenant. New JWTs also carry `workspaceId`; transitional Cloud services retain the equal `tenantId` alias.

**PARTIAL:** the OAuth authorization page does not yet render a workspace picker, so clients must use Personal by default or supply a Platform-approved `workspace_id` flow. Some team intelligence remains connector-user scoped even though core email/provider access is workspace scoped.

## Required security tests

- legacy personal credential remains isolated;
- token scoped to Workspace A cannot query a mailbox from Workspace B;
- mailbox ID guessing cannot bypass context;
- workspace switching rechecks membership and role;
- revoked membership invalidates or blocks existing workspace access;
- tools never return provider, relay, or tunnel secrets;
- send approval remains human-bound after workspace migration.
