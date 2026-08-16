# Mailwarden Specification

Mailwarden is an AI-native email operating layer. Its primary interface is not a traditional email client, but rather a conversational AI client (such as ChatGPT or Claude) via the Model Context Protocol (MCP).

## Core Design Principle

> **AI determines meaning. Code determines permission.**

- **AI may interpret**: Importance, intent, relationships, urgency, action items, thread summaries, project relevance, deadlines.
- **Deterministic backend code decides**: Authentication, tenant boundaries, account ownership, scope validation, send approvals, token validity, destructive actions, audit logging.

## System Architecture

```
[Gmail API] ─────────┐
[Outlook Graph] ─────┼── Provider Adapters (Isolated & Abstracted)
[Proton Bridge] ─────┘
                          │
                          ▼
                  [Email Normalizer]
                          │ (Safe Sanitization & Signal Extraction)
                          ▼
                   [Data Storage] (PostgreSQL / D1 / SQLite with Drizzle ORM)
                   ┌──────┼──────┐
                   ▼      ▼      ▼
                Threads Senders Relationships / Projects
                   └──────┼──────┘
                          ▼
                  [Context Builder]
                          │
                          ▼
                 [Deterministic Signals]
                          │
                          ▼
                    [MCP Server] (JSON-RPC stdio & SSE/HTTP)
                          │
                          ▼
                      [ChatGPT] (Semantic Reasoning & User Interactions)
                          │
                          ▼
                    [MCP Actions]
                          │
                          ▼
               [Authorization Policy] (Server-Side Principal & Scope Enforcement)
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
         Read Mail   Stored Drafts  Mailbox State
             │            │            │
             └────────────┼────────────┘
                          ▼
            [Exact Payload Confirmation & Idempotent Send]
                          ▼
                   [Email Provider]
```

## Security Invariants

1. **Strict Multi-Tenancy**: User A can never access User B's mailbox, messages, threads, drafts, signatures, relationships, or provider connections.
2. **Credential Confidentiality**: Provider credentials, access tokens, refresh tokens, and encryption keys never reach an AI model, are never logged, and are never returned via MCP.
3. **No Instruction Elevation**: Untrusted email content is treated strictly as data, never instructions. Prompt injections cannot elevate privileges or bypass backend authorization.
4. **Server-Side Authentication**: AuthPrincipal (tenantId, userId, scopes) is determined server-side from session tokens/OAuth, never from untrusted AI/MCP tool arguments.
5. **Granular Permissions**: Operations require explicit scopes (`mail.read`, `mail.draft`, `mail.send`, `signatures.manage`, etc.). Read access never permits mutation or drafting; drafting never permits sending.
6. **Exact Payload Confirmation**: Sending requires explicit approval bound to a cryptographic SHA-256 hash of the exact canonical draft payload (sender identity, to, cc, bcc, subject, body, signature, attachments, reply target). Any edit invalidates the approval.
7. **Idempotent Sending**: Sending operations are strictly idempotent with send-attempt tracking. Retries return the existing send result and never send duplicate emails.
8. **Audit Trail**: All sensitive actions (MCP tool calls, auth changes, draft edits, approvals, sending, mailbox mutations) are permanently recorded in structured audit logs without leaking private bodies.
9. **Dry Run Mode**: When `MAILBOX_MUTATIONS_ENABLED=false`, mailbox state mutations (`mark_read`, `mark_unread`, `archive`) are simulated as dry-run logs without touching the remote provider.
10. **Safe Defaults**: High-visibility defaults protect human senders, invoices, security alerts, deadlines, and active client threads from being hidden.

## MCP Tools Catalog

### Read & Overview
- `get_inbox_status`: Cross-account summary with totals, attention candidates, and account health.
- `get_attention_queue`: Prioritized queue of items requiring user attention based on signals, classifications, and relationships.
- `get_account_status`: Status of connected accounts and identities.
- `get_message`: Normalized message details with safe text extraction and metadata.
- `get_thread`: Bounded thread context (default recent 5 messages) with participant history.
- `search_mail`: Cross-account structured search with filters (sender, organization, project, date, unread, action required).
- `get_sender_context`: Aggregated sender profile, seen count, reply ratio, and historical importance.
- `get_relationship_context`: User-defined and inferred relationship profile, associated organizations, and active projects.
- `get_thread_state`: Thread intelligence, open loops (`user_owes_reply`, `other_party_owes_reply`, `pending_action`), and summaries.
- `get_recent_important_mail`: High-importance messages across accounts.
- `get_waiting_for_user`: Messages where the user owes a reply or action.
- `get_user_waiting_for`: Messages where the user is waiting for an external reply.

### Memory & User Corrections
- `correct_classification`: Overwrite stored classification (importance, category, intent, workflow state).
- `set_sender_relationship`: Explicitly define relationship type (client, coworker, recruiter, vendor, etc.).
- `set_sender_preference`: Set reply expectations and importance overrides.
- `associate_sender_with_project`: Link sender to a project or organization.
- `set_account_priority`: Configure account priority and role (primary work, personal, freelance, etc.).
- `set_thread_state`: Update open loops or manual thread summary.

### Mailbox Actions
- `mark_read`: Mark a message as read in the provider (respects dry run).
- `mark_unread`: Mark a message as unread in the provider (respects dry run).
- `archive`: Archive a message in the provider (respects dry run).

### Drafting & Signatures
- `draft_reply`: Create a persistent server-side draft in response to a thread/message.
- `draft_email`: Create a new standalone draft.
- `draft_forward`: Create a forward draft with original message context.
- `get_draft`: Retrieve draft details and current canonical payload hash.
- `edit_draft`: Modify draft recipients, subject, body, or parameters.
- `list_drafts`: List user's active drafts.
- `set_draft_signature`: Apply a stored signature profile (`personal`, `consulting`, `work`, `compact`, etc.).
- `remove_draft_signature`: Clear signature from draft.

### Exact Payload Approval & Sending
- `request_send_approval`: Generate canonical payload hash and register a pending send approval for explicit user confirmation.
- `send_draft`: Send the draft after verifying valid unexpired approval matching the exact current payload hash.
- `schedule_send`: Schedule an approved draft for future dispatch.
- `cancel_scheduled_send`: Cancel a scheduled send before dispatch.

### Privacy & Accounts
- `list_accounts`: List connected email accounts and status.
- `disconnect_account`: Revoke and permanently purge provider credentials.
- `list_permissions`: Show granted OAuth/MCP scopes for current session.
