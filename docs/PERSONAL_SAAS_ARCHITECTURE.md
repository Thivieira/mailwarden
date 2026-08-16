# Mailwarden Personal-First SaaS Architecture

Mailwarden is designed as a personal email intelligence service first, while keeping the structural isolation required to become a paid SaaS without a future rewrite.

## Product model

The normal unit is not a company workspace. It is a **private Mailwarden vault** owned by a person.

A user can connect multiple accounts to the same vault, including:

- multiple Gmail accounts
- multiple Outlook / Microsoft accounts
- Proton Mail through Bridge/gateway
- work, personal, freelance, entertainment, and other account roles

All connected accounts appear as one conversational email environment while retaining their own provider identity, sending identity, connection status, credentials, sync state, and account-level preferences.

The model is:

`user -> private vault (tenant) -> email accounts -> identities/messages/context`

The `tenant` boundary is primarily a privacy and isolation boundary. It must not imply that the mailbox data is shared with every member of an organization.

## Personal-first rules

1. A new personal user receives one private vault by default.
2. A vault may contain many email accounts.
3. Provider credentials are stored independently for every connected account.
4. Email data and learned relationship context are scoped to the authenticated user and vault.
5. The model never selects a tenant or user ID. Authentication establishes both internally.
6. Account names, roles, and sending identities should be understandable to a normal person. Users should be able to say things such as "my personal Gmail", "my consulting account", or "send from Outlook" instead of handling internal IDs.
7. Cross-account summaries are expected behavior, not a special feature.
8. A failure in one provider must be visible. Mailwarden must never silently substitute fake data or present a partial cross-account summary as complete.

## SaaS readiness

The backend may later support subscriptions and account limits without changing the privacy model.

Possible plans may vary by:

- number of connected accounts
- sync frequency
- history/retention length
- advanced relationship memory
- automation features
- shared/team mailbox capabilities

Billing concerns must remain separate from mailbox authorization. Payment status must never broaden mailbox access.

## Shared and organization mailboxes

Shared mailboxes are intentionally **not** inferred from tenant membership.

If team support is added later, mailbox access must use explicit mailbox grants such as:

`mailbox_grants(user_id, account_id, permissions)`

Organization membership alone must never mean that a member can read another person's private inbox.

A personal account remains private even if its owner later joins a company workspace.

## Privacy baseline

Mailwarden should minimize the amount of sensitive content it keeps while still providing useful cross-account intelligence.

- Providers remain the canonical source of mail where practical.
- OAuth refresh tokens and Proton gateway credentials are encrypted at rest.
- Provider credentials never enter ChatGPT/model context.
- Attachments are not retained permanently unless a feature explicitly requires it.
- Email bodies may have configurable retention/cache policies in the future.
- Users can disconnect individual accounts independently.
- Disconnecting an account removes active provider credentials and stops future ingestion.
- Users can purge cached body content without deleting their provider mailbox.
- Users can delete learned sender/relationship memory independently.
- Users can export their stored Mailwarden data.
- Sensitive actions are audited without duplicating full email contents into audit logs.

## Model boundary

Email content is untrusted input.

AI determines meaning. Code determines permission.

No email body, sender instruction, attachment, or model output can change the authenticated user, vault, account ownership, scopes, or send authorization.

## Sending

Each connected account owns one or more sending identities.

Natural language should resolve a sending account by human-friendly address/role when unambiguous. When multiple accounts are plausible, ChatGPT should ask which account to use rather than guess.

Drafting is autonomous. Sending is not.

Every send must still use the stored-draft, exact-payload-hash, explicit-confirmation flow. An approval for one account/draft cannot authorize a different account or modified message.

## Current implementation consequence

Mailwarden should be dogfooded as a real personal multi-account product now, even before public signup/billing exists.

The current single-owner login is a temporary authentication UX for the first deployment. It is not a license to introduce singleton assumptions into account, message, credential, sync, or MCP code.

All core services must continue to operate using authenticated `tenantId + userId` and support multiple `email_accounts` for that principal.
