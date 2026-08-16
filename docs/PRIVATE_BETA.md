# Mailwarden Private Beta

The current target is deliberately small: three real people using Mailwarden every day before any public SaaS launch.

## Beta structure

Each person gets a completely separate private vault:

```text
Thiago -> private vault -> Gmail / Outlook / Proton accounts
Buddy A -> private vault -> their Gmail / Outlook / Proton accounts
Buddy B -> private vault -> their Gmail / Outlook / Proton accounts
```

A private vault is the security boundary. Users do not share email data, credentials, drafts, relationship memory, rules, audit history, or connected accounts.

A single user may connect multiple personal and professional email accounts and ask Mailwarden questions across all of them.

Shared/company mailboxes are a future feature and must require explicit grants. Membership in the same company must never implicitly grant mailbox access.

## Authentication

The deployment owner logs in with `OWNER_EMAIL` and `OWNER_LOGIN_SECRET`. The first successful login creates that owner's private vault and migrates the env bootstrap secret into a per-user hashed credential. Do not run `beta:provision` for the owner.

`BETA_ADMIN_SECRET` is only for provisioning buddy #1 and buddy #2 later. Mailwarden generates a strong login secret for those users and stores only a salted PBKDF2-SHA256 hash. The plaintext secret is returned once during provisioning.

Set a separate production secret:

```bash
bun x wrangler secret put BETA_ADMIN_SECRET
```

Do not reuse `OWNER_LOGIN_SECRET`, `AUTH_SECRET`, provider OAuth secrets, or encryption keys as the beta admin secret.

## Provision a beta user

Skip this until Gmail through Claude works for the owner. Then, with `APP_BASE_URL` pointing at the deployed Mailwarden Worker and `BETA_ADMIN_SECRET` available only in your local shell:

```bash
bun run beta:provision buddy@example.com "Buddy Name"
```

Mailwarden returns the user's private vault ID, user ID, and login secret. Share only the login secret and only through a private channel.

If a beta login secret is lost or exposed, rotate it through the protected `/auth/beta/rotate-secret` endpoint. The previous secret stops working immediately.

## First dogfood client: Claude

ChatGPT Plus is not currently listed for custom MCP connectors with write actions. Use Claude (Pro/Max/Team/Enterprise) for the first real inbox test.

In Claude: Settings → Connectors → Add custom connector:

```text
https://mailwarden.corenet.workers.dev/mcp
```

Claude discovers Mailwarden's OAuth + Dynamic Client Registration flow. The owner signs in with `OWNER_EMAIL` and `OWNER_LOGIN_SECRET`. Later beta users sign in with the email and login secret from provisioning. Tokens, provider accounts, email data, and tool calls stay scoped to that person's private vault.

Prove this path before Outlook or Proton:

```text
REAL GMAIL → Google OAuth → Mailwarden sync → D1 → Claude → summary + draft
```

## Multi-account expectation

A beta user can connect multiple accounts from the same or different providers. For example:

```text
Personal Gmail
Work Gmail
Consulting Outlook
Personal Proton
```

The user should be able to say:

- "Summarize all my email."
- "Only check my work accounts."
- "Anything important in Proton?"
- "This Outlook account is Consulting."
- "Draft a reply from my work Gmail."

Internal account IDs are implementation details and should not be required in normal conversation.

## Safety during beta

Keep `MAILBOX_MUTATIONS_ENABLED=false` while validating classification and organization behavior against real mail.

Reading, summarization, relationship memory, prioritization, and draft preparation can be tested safely first. Real sending remains protected by Mailwarden's explicit human send-approval flow.

Do not enable automatic destructive deletion during beta.

## What we intentionally do not build yet

Before the three-person beta is solid, do not add:

- public signup
- Stripe/billing
- pricing plans
- organization administration
- shared inboxes
- seat management
- enterprise SSO
- large settings dashboards
- automatic AI sending

## SaaS path after beta

The beta architecture is intentionally compatible with a later SaaS layer.

A public product can later add:

```text
identity/signup
  -> private vault
  -> plan entitlement
  -> connected-account limits
  -> sync/retention features
  -> billing/customer lifecycle
```

Billing and plan state must never become the authorization boundary. Mailbox authorization remains based on authenticated user/vault ownership and explicit scopes.

Possible future plan dimensions include connected account count, synchronization frequency, retention duration, advanced automation, and optional always-on Proton infrastructure. Pricing decisions should be made from real beta usage rather than guessed before dogfooding.

## Beta success criterion

Do not call the beta successful because the architecture or tests look good.

The milestone is all three people independently connecting real inboxes and naturally using Mailwarden inside Claude for:

1. cross-account summaries;
2. attention prioritization;
3. sender/thread context;
4. persistent personal rules;
5. drafting;
6. human-approved sending;
7. account disconnect/export/privacy controls.

Only after those workflows feel reliable should Mailwarden move toward public SaaS packaging.
