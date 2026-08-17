# Mailwarden Private Beta — Dogfood Runbook

The current target is deliberately small: three real people using Mailwarden every day before any public SaaS launch.

## Beta structure

Each person gets a completely separate private vault:

```text
Thiago -> private vault -> Gmail accounts
Buddy A -> private vault -> their Gmail accounts
Buddy B -> private vault -> their Gmail accounts
```

A private vault is the security boundary. Users do not share email data, credentials, drafts, relationship memory, rules, audit history, or connected accounts.

Gmail is the only provider in scope for this dogfood pass. Do not expand into Outlook, Proton, billing, buddy provisioning, settings expansion, or public SaaS work until the Gmail path is proven.

## Authentication

The deployment owner logs in with `OWNER_EMAIL` and `OWNER_LOGIN_SECRET`. The first successful login creates that owner's private vault and migrates the env bootstrap secret into a per-user hashed credential. Do not run `beta:provision` for the owner.

If owner auth fails after the first successful login: **stop**. Do not blindly rotate `OWNER_LOGIN_SECRET`. After hashed credential persistence, the env bootstrap secret is no longer the live password for that vault — rotating the Wrangler secret alone will not fix a wrong password and can strand the owner.

`BETA_ADMIN_SECRET` is only for provisioning buddy #1 and buddy #2 later. Mailwarden generates a strong login secret for those users and stores only a salted PBKDF2-SHA256 hash. The plaintext secret is returned once during provisioning.

## Production endpoints

```text
Worker:  https://mailwarden.corenet.workers.dev
MCP:     https://mailwarden.corenet.workers.dev/mcp
Health:  https://mailwarden.corenet.workers.dev/health
```

## Human-session approval boundary

Send confirmation requires a real human browser session on the Mailwarden origin.

- The model may know `approvalId` and `reviewUrl`.
- The review URL alone is **not** authorization.
- An API/MCP bearer token is **not** human approval auth.
- Human sessions (`mw_human_session`) are cryptographically incompatible with API/MCP JWTs (different audience, `typ`, and `kind`; empty scopes).
- Confirmation requires: valid human session owning the approval **and** the one-time `confirmationNonce`.
- The approved payload is bound to the exact canonical outbound payload hash. Any edit after approval invalidates send.

Invariant:

```text
THE MODEL MAY PREPARE AND REQUEST.
ONLY A HUMAN MAY AUTHORIZE.
THE APPROVED PAYLOAD MUST MATCH WHAT ACTUALLY LEAVES GMAIL.
```

## Dogfood phases

### Phase 4 — ChatGPT Developer Mode (not Claude)

Use ChatGPT with Developer Mode / a workspace plan that supports custom MCP connectors with write actions.

Add the custom MCP connector:

```text
https://mailwarden.corenet.workers.dev/mcp
```

Complete OAuth on the Mailwarden origin (`OWNER_EMAIL` + Mailwarden login secret). Successful authorize mints the human browser session cookie on Mailwarden; that cookie is what later unlocks review/confirm.

Prove:

```text
REAL GMAIL → Google OAuth → Mailwarden sync → D1 → ChatGPT → summary + draft
```

### Phase 6 / 7 — Resume here after this hardening deploy

Human resumes real dogfood at Phase 6/7:

1. Confirm ChatGPT can list/sync Gmail via MCP tools.
2. Ask for a summary of recent mail.
3. Ask Mailwarden to create a draft addressed to **yourself** (self-send only for the first real send).
4. Do **not** send yet — stop after draft + approval request if you are still validating the review UI.

### Phase 8 — Real send

Phase 8 is a **real send**.

- `MAILBOX_MUTATIONS_ENABLED=false` does **not** block send. Dry-run only covers mailbox mutations (`mark_read`, `archive`, etc.).
- Address the test email to yourself.
- Flow: draft → `request_send_approval` → open `reviewUrl` in a browser where you are signed in to Mailwarden → read From/To/Cc/Subject/body/thread → confirm → `send_draft`.
- Do not claim success unless `send_draft` returns provider success.

### Phase 9 — Tamper / hash mismatch check

1. Create draft
2. Request approval
3. Human reviews
4. Human **approves**
5. Edit/mutate the draft (recipient, body, Cc, or thread)
6. Attempt send using the **old** approval
7. Expect hash mismatch and **zero** provider dispatch

The binding is the exact canonical outbound payload (From, To, Cc, Subject, final `textBody`, `threadId`, plus security-binding ids) — not a claim of hashing raw MIME bytes unless that serialization is independently proven.

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
- Outlook / Proton expansion for this dogfood pass

## Beta success criterion

Do not call the beta successful because the architecture or tests look good.

The milestone is all three people independently connecting real inboxes and naturally using Mailwarden inside ChatGPT for:

1. cross-account summaries;
2. attention prioritization;
3. sender/thread context;
4. persistent personal rules;
5. drafting;
6. human-approved sending;
7. account disconnect/export/privacy controls.

Only after those workflows feel reliable should Mailwarden move toward public SaaS packaging.
