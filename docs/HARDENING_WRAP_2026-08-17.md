# Security hardening wrap — 2026-08-17

Session wrap for the ChatGPT → Mailwarden → Gmail send boundary. Stop here until the human finishes Phase 6/7 dogfood and pauses after approval (before Phase 8 real send).

## What shipped

Two security claims are now enforced in code, not assumed:

1. **ChatGPT cannot manufacture human approval.** The review URL + nonce alone is not enough. Confirm requires a real `mw_human_session` cookie owned by the approval’s human, plus the one-time nonce.
2. **The approved canonical payload covers what Gmail actually sends.** Review, hash, and MIME body agree on From/To/Cc/Subject/final `textBody`/`threadId`. Unsupported fields are rejected before approval/dispatch.

## Commits (on `main`, pushed to `origin`)

| SHA | Message |
|-----|---------|
| `f351186` | `fix(approval): bind send confirmation to human session` |
| `bd65ef6` | `fix(send): unify reviewed and dispatched email payload` |
| `f4f4cfc` | `docs(dogfood): correct ChatGPT and tamper flow` |
| `5f16f14` | `test(send): type signature profile query for strict tsc` |

Tip of `main` / `origin/main`: **`5f16f14`**.

## Deploy

| Field | Value |
|-------|-------|
| Production | https://mailwarden.corenet.workers.dev |
| MCP | https://mailwarden.corenet.workers.dev/mcp |
| Live `/health` commit at wrap | `5f16f14` |
| Worker version (last publish) | `b3c722dc-e371-4467-b519-b50ec94d8b81` |
| D1 | `mailwarden-prod` (`a7aef699-12eb-4ea8-946b-d77d54c944d1`) |
| Migrations this pass | **None** (0000–0002 remain stamped as already present) |
| Secrets | Unchanged (`AUTH_SECRET`, encryption, owner, Google OAuth, etc.) |
| `MAILBOX_MUTATIONS_ENABLED` | `false` (does **not** block send) |

Verify anytime:

```bash
curl -sS https://mailwarden.corenet.workers.dev/health | jq
```

Expect: `status: ok`, database healthy, encryption configured, owner auth configured, Google configured, mailbox mutations disabled, `commit` matching deployed tip.

## Security model (short)

### Human session vs API/MCP bearer

| | API / MCP JWT | Human browser JWT |
|--|---------------|-------------------|
| Cookie / header | `Authorization: Bearer` | `mw_human_session` (HttpOnly, SameSite=Lax) |
| Audience | `APP_BASE_URL` | `APP_BASE_URL/human-session` |
| Protected `typ` | default | `MW-HUMAN-SESSION` |
| Payload | normal scopes | `kind: "human"`, **empty scopes** |
| Mint | OAuth token exchange / auth APIs | OAuth authorize success + approval sign-in |
| Can confirm send? | **No** | **Yes**, if owner of approval + matching nonce |

Revocation: delete the `sessions` row (no `revokedAt` column).

### Approval lifecycle

```text
PENDING
  → human session (owner) + nonce + Origin check + atomic CAS
CONFIRMED
  → send_draft (hash match + outbound gates)
SENT / USED
```

Concurrent confirms: exactly one CAS winner. Replay confirm: fails.

### Canonical outbound payload (hashed)

`tenantId`, `userId`, `accountId`, `identityId`, `fromEmail`, `to`, `cc`, `subject`, `textBody`, `threadId`

Not hashed as independent provider effects: `renderedSignature` (metadata; already in `textBody`), `replyToMessageId`, signature profile id.

Rejected before approval/dispatch: Bcc, htmlBody, attachments; identity email ≠ connected Gmail account.

Gmail wire: To, Cc, Subject, plain `textBody`, plus `threadId` on `/messages/send`.

## Tests at ship time

- Full suite: **127 pass / 0 fail**
- Typecheck: green
- Adversarial human-session suite: public review, bearer≠human, nonce-alone, wrong user, race, replay, no MCP confirm tool
- Outbound suite: signature once, review body == MIME body, Cc, threadId tamper, approve-then-mutate, unsupported fields, identity mismatch, zero provider calls on failed gates

## Dogfood resume (human)

Full runbook: [`PRIVATE_BETA.md`](./PRIVATE_BETA.md).

**Resume at Phase 6/7** — stop after approving; do **not** send until Phase 8 is intentional.

1. ChatGPT Developer Mode → connect MCP `https://mailwarden.corenet.workers.dev/mcp`
2. Sign in (establishes `mw_human_session`)
3. Connect Gmail with read/draft/send scopes
4. Refresh → summarize last 24h → read one real thread
5. Draft short test to **yourself**, subject `Mailwarden real-send dogfood` — do not send
6. Request human approval — do not send
7. On review page: check From/To/Cc/Subject/body/thread/attachments; signature once → **Approve**
8. Pause: capture screenshot / note result before asking ChatGPT to send
9. Only then Phase 8: “It’s approved. Send it.”
10. Phase 9 (optional after): approve → mutate draft → expect hash mismatch and zero provider dispatch

## Out of scope this pass

Outlook, Proton, billing, buddy provisioning, settings expansion, public SaaS, Send-As aliases, raw MIME-byte hashing claims, real email from the agent.

## Hygiene note

Earlier production briefly reported build commit `f4f4cfc` while tip was already `5f16f14` (test-only delta). A later stamp+deploy aligned live `/health` to `5f16f14`. Prefer `bun run ship` (or stamp `ui:build` before `wrangler deploy`) so the Worker always advertises the commit actually uploaded.
