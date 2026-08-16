# Mailwarden 🛡️

> **Your email, managed through normal conversation.**

Mailwarden connects your email accounts to your conversational AI (such as ChatGPT) so you can ask what matters, see who needs a reply, understand conversation history, and prepare responses without living inside your inbox.

---

## What Mailwarden Feels Like

You don't need to configure complex automation or learn new tools. You simply talk:

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

---

## Safe By Default

A new user does not need to design an email workflow before Mailwarden becomes useful. Mailwarden comes with a conservative **Balanced** policy out of the box:

- **Important and uncertain emails stay visible in your inbox.**
- **Obvious low-value/junk mail may be archived (never permanently deleted).**
- **Uncertain messages are left alone** (if Mailwarden isn't confident, it does nothing).
- **Sending email always requires your human confirmation.** AI drafts and edits, but only you authorize dispatches.
- **Dry-run mode is enabled by default** (`MAILBOX_MUTATIONS_ENABLED=false`) so you can test safely before enabling automated mutations.

---

## Onboarding Presets

Mailwarden supports three simple presets:

1. **Balanced (Recommended Default)**:
   - Obvious junk/newsletters are archived.
   - Routine, interesting, and important emails remain in your inbox.
   - Uncertain emails are untouched.
2. **Safe**:
   - Organizes and prioritizes emails in attention views with almost no automatic movement.
3. **Inbox Zero**:
   - More actively archives routine broadcast and low-value emails, keeping only important and actionable emails in your inbox.
   - Never permanently deletes emails by default.

You can switch presets or customize rules anytime simply by talking.

---

## Conversational Rules & Precedence

When you teach Mailwarden (e.g. *"Anything from this client is important"* or *"Archive newsletters automatically"*), your requests are converted into persistent structured policy records.

Mailwarden resolves rules deterministically using a strict precedence hierarchy:

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

User-defined rules always outrank inferred model behavior.

---

## Supported Providers & Cross-Account Intelligence

Mailwarden unifies your email across providers:
- **Google Workspace / Gmail** (OAuth 2.0 PKCE)
- **Microsoft 365 / Outlook** (OAuth 2.0 PKCE)
- **Proton Mail** (Proton Mail Bridge)

### Proton Local Connector Architecture
To respect Proton's end-to-end encryption model without requiring users to share Proton passwords or operate cloud servers:

```
[User Computer (e.g., Thiago-PC)]
Proton Mail Bridge
      ↕ localhost IMAP/SMTP
Mailwarden Proton Connector
      ↓ authenticated outbound HTTPS/WSS
Cloudflare Worker (Mailwarden)
```

- **Clear status visibility**: e.g., *"Proton: Connected through Thiago-PC (last seen 2 minutes ago)"* or *"Proton: Offline (Connector last seen 3 hours ago)"*.
- **Honest cross-account summaries**: If your Proton connector is offline, Mailwarden explicitly lets you know that Proton messages are not included, rather than silently presenting incomplete results.

---

## Multilingual Support

Mailwarden natively supports conversational onboarding and interactions in multiple languages, including **English** and **Portuguese (PT-BR)**.

### Portuguese (PT-BR) Example:
> *"Conecte seus e-mails ao ChatGPT. Ele mostra o que realmente importa, quem está esperando uma resposta e ajuda você a responder sem precisar procurar e-mail por e-mail."*

---

## Developer & Deployment Guide

Mailwarden is deployed as a production Cloudflare Worker backed by serverless Cloudflare D1.

- **Production Origin**: `https://mailwarden.corenet.workers.dev`
- **MCP SSE Endpoint**: `https://mailwarden.corenet.workers.dev/mcp/sse`
- **MCP JSON-RPC Endpoint**: `https://mailwarden.corenet.workers.dev/mcp/rpc`
- **Health Endpoint**: `https://mailwarden.corenet.workers.dev/health`

### Local Development
```bash
# 1. Install dependencies
bun install

# 2. Run database migrations (D1 / SQLite)
bun run db:migrate

# 3. Seed demo data
bun run db:seed

# 4. Start local development server
bun run dev

# 5. Run test suite (58+ automated tests)
bun test

# 6. Typecheck
bun run typecheck
```

---

## Security Invariants

> **AI determines meaning. Code determines permission.**

- **Multi-Tenant Isolation**: Database queries strictly filter by `tenant_id` and `user_id`.
- **Envelope Encryption**: Provider credentials encrypted at rest with AES-256-GCM and key versioning.
- **Exact Payload Hashing**: Cryptographic SHA-256 confirmation ensures the human approves the exact email being dispatched.
- **Idempotent Sending**: Eliminates accidental duplicate email transmissions.
- **Dry-Run Safe**: Default `MAILBOX_MUTATIONS_ENABLED=false` prevents unintended mailbox modifications during initial evaluation.
