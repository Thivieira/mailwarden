# Mailwarden

> Your email, managed through normal conversation.

Mailwarden connects your email accounts to a conversational AI (Claude today; ChatGPT later) so you can ask what matters, see who needs a reply, check history with someone, and prepare responses without living in your inbox.

## What it feels like

You talk. You don't set up automation or learn a new tool:

- *"What needs my attention?"*
- *"Who is waiting for me?"*
- *"Who am I waiting for?"*
- *"What happened with this client?"*
- *"Why is this email important?"*
- *"This person is actually a client."*
- *"Archive newsletters automatically."*
- *"Never archive recruiter emails."*
- *"Put receipts in Finance."*
- *"Draft a reply."*
- *"Use my professional signature."*

## Safe by default

You don't design an email workflow before Mailwarden is useful. A new account starts on the **Balanced** policy:

- Important and uncertain emails stay in your inbox.
- Obvious junk may be archived (never permanently deleted).
- If Mailwarden isn't sure, it leaves the message alone.
- Sending always needs your confirmation. The AI drafts; only you authorize the send.
- Dry-run is on by default (`MAILBOX_MUTATIONS_ENABLED=false`) so mailbox changes stay simulated until you turn them on.

## Onboarding presets

Three presets:

1. **Balanced** (default): archives obvious junk and newsletters; leaves routine, interesting, and important mail in the inbox; leaves uncertain mail alone.
2. **Safe**: organizes and ranks mail in attention views with almost no automatic movement.
3. **Inbox Zero**: archives more routine and low-value mail, keeping important and reply-needed mail in the inbox. Still never permanently deletes by default.

Switch presets or change rules by talking.

## Conversational rules and precedence

When you teach Mailwarden (*"Anything from this client is important"*, *"Archive newsletters automatically"*), those requests become persistent policy records.

Rules resolve in this order:

```
Explicit message / thread override
        ↓
Explicit sender / domain rule
        ↓
Relationship rule (client, coworker, recruiter, vendor)
        ↓
Project / Organization rule
        ↓
Account rule
        ↓
Classification policy (junk, routine, interesting, important, critical)
        ↓
Global default
```

Your rules always beat what the model inferred on its own.

## Providers

Mailwarden works across:

- Google Workspace / Gmail (OAuth 2.0 PKCE)
- Microsoft 365 / Outlook (OAuth 2.0 PKCE)
- Proton Mail (Proton Mail Bridge on your machine)

### Proton connector

Proton stays end-to-end encrypted. You don't share a Proton password with Mailwarden's cloud, and you don't run Proton's own cloud for this:

```
[Your computer]
Proton Mail Bridge
      ↕ localhost IMAP/SMTP
Mailwarden Proton Connector
      ↓ authenticated outbound HTTPS/WSS
Cloudflare Worker (Mailwarden)
```

Status is plain: *"Proton: Connected through Thiago-PC (last seen 2 minutes ago)"* or *"Proton: Offline (Connector last seen 3 hours ago)"*.

If the Proton connector is offline, Mailwarden says so and excludes those messages from cross-account answers instead of pretending the picture is complete.

## Languages

Onboarding and conversation work in English and Portuguese (PT-BR).

Portuguese example:

> *"Conecte seus e-mails ao ChatGPT. Ele mostra o que importa, quem está esperando uma resposta e ajuda você a responder sem precisar procurar e-mail por e-mail."*

## Developer and deployment

Mailwarden runs as a Cloudflare Worker with D1.

- Production: `https://mailwarden.corenet.workers.dev`
- MCP SSE: `https://mailwarden.corenet.workers.dev/mcp/sse`
- MCP JSON-RPC: `https://mailwarden.corenet.workers.dev/mcp/rpc`
- Health: `https://mailwarden.corenet.workers.dev/health`

### Local development

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
bun test
bun run typecheck
```

## Security invariants

> AI determines meaning. Code determines permission.

- Queries are filtered by `tenant_id` and `user_id`.
- Provider secrets at rest use AES-256-GCM with key versioning.
- Send approval is bound to a SHA-256 hash of the exact payload the human saw.
- Sends are idempotent so identical dispatches don't duplicate.
- `MAILBOX_MUTATIONS_ENABLED=false` by default keeps first evaluation from changing the mailbox.
