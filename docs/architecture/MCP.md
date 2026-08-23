# MCP architecture

## Current implementation

**SHIPPED:** Mailwarden exposes MCP over streamable HTTP, JSON-RPC, and SSE-compatible routes. Bearer/OAuth authentication resolves an `AuthPrincipal` containing one `tenantId`, one `userId`, permission scopes, and session metadata. Tools cover inbox status, attention, waiting states, search/read, drafts, human-approved sending, policies, relationships, onboarding, synchronization, privacy, and settings UI resources.

MCP clients never receive provider credentials. Tool services query stored data and provider adapters on the server side. Mutation and send scopes are enforced in code; sending still requires a separate human approval flow.

## Current workspace behavior

The principal's single tenant is the effective workspace. This preserves existing personal-vault isolation. MCP does not yet list or switch workspaces and must not infer cross-workspace aggregation.

## Planned workspace behavior

Every MCP session/token will resolve exactly one `WorkspaceContext` unless a future tool explicitly requests and authorizes another workspace. Safe options include:

- issue a workspace-scoped MCP credential/token;
- require an explicit workspace selector during OAuth and bind it into the grant;
- provide a controlled workspace-switch flow that issues a new scoped token.

Do not accept an arbitrary `tenantId` tool argument as authorization. Search, attention, waiting, inbox status, mailbox actions, drafts, policies, and settings all use the resolved workspace.

## Contract ownership

`packages/contracts` owns `WorkspaceContext` and mailbox/provider protocol types. GPT-5.6 Sol owns final MCP workspace semantics and any schema/migration changes. Product UI may request workspace-selection fields; Bridge may request relay context fields; neither should redefine the canonical contract locally.

## Compatibility

Existing personal bearer and OAuth credentials must continue to resolve their current tenant during migration. A compatibility layer may map legacy token `tenantId` directly to the user's Personal Workspace until all grants are workspace-aware.

## Required security tests

- legacy personal credential remains isolated;
- token scoped to Workspace A cannot query a mailbox from Workspace B;
- mailbox ID guessing cannot bypass context;
- workspace switching rechecks membership and role;
- revoked membership invalidates or blocks existing workspace access;
- tools never return provider, relay, or tunnel secrets;
- send approval remains human-bound after workspace migration.
