# Architecture Decision Records (ADRs)

## ADR-001: Model Context Protocol (MCP) as the Primary AI Interface
- **Status**: Accepted
- **Context**: Conversational AI clients (ChatGPT, Claude, Cursor) need structured access to email actions and context without custom per-client plugins.
- **Decision**: Expose all reading, intelligence, drafting, approval, and sending actions as standardized MCP Tools over both stdio and HTTP/SSE transports using `@modelcontextprotocol/sdk`.
- **Consequence**: Universal compatibility across LLM providers and UI clients.

---

## ADR-002: Exact Payload Approval Hashing Before Sending
- **Status**: Accepted
- **Context**: LLM output must not possess unilateral permission to dispatch emails. Sending must require explicit human confirmation, and any intermediate edits to the draft must not be silently sent under an outdated approval.
- **Decision**: Calculate a deterministic canonical SHA-256 hash of the exact draft payload (recipients, subject, text, HTML, signature, reply target). Stored send approvals bind to this hash. When `send_draft` is called, the current draft hash is recomputed; if it differs from the approval hash, execution is aborted.
- **Consequence**: Complete prevention of prompt-injection-driven sending or desynchronized draft dispatch.

---

## ADR-003: Deterministic Rule Engines Outranking LLM Classifications
- **Status**: Accepted
- **Context**: LLMs can hallucinate importance or fail to prioritize urgent legal, financial, or security emails.
- **Decision**: Signals like invoices, deadlines, security alerts, list-unsubscribe headers, and user-defined sender relationships are extracted deterministically in code. User corrections (`userCorrected: true`) permanently override automatic classifications.
- **Consequence**: "AI determines meaning. Code determines permission."

---

## ADR-004: True 2-Tier Envelope Encryption for Provider Credentials
- **Status**: Accepted (Hardened)
- **Context**: Sensitive OAuth refresh tokens and IMAP/SMTP passwords stored in the database must be cryptographically protected and tenant-isolated.
- **Decision**: Implement true 2-tier Envelope Encryption using AES-256-GCM. A unique 256-bit Data Encryption Key (DEK) is generated for each record. The payload is encrypted with the DEK, and the DEK is wrapped with the Master Key Encryption Key (KEK) using Authenticated Additional Data (AAD) bound to `tenantId` and `userId`.
- **Consequence**: Multi-tenant cryptographic isolation. Even with raw database access, User A cannot decrypt Boss B's credentials because the AAD context and KEK derivation cannot be satisfied.

---

## ADR-005: Dry-Run Mutation Simulation
- **Status**: Accepted
- **Context**: During development, testing, or initial user onboarding, destructive or stateful mailbox mutations (`mark_read`, `archive`, `mark_unread`) should be safely verifiable without touching remote mailboxes.
- **Decision**: Controlled by `MAILBOX_MUTATIONS_ENABLED=false`. All mutations are simulated, logged to `mailbox_actions` and `audit_events`, and returned with `simulated: true`.
- **Consequence**: Zero accidental mailbox data corruption.

---

## ADR-006: Production Authentication & Secrets Invariant (Zero Secrets in URLs)
- **Status**: Accepted
- **Context**: Passing tokens or JWTs in URL paths (`/t/:token/...`) or query strings exposes secrets in server access logs, reverse proxy logs, browser history, and referer headers.
- **Decision**: All production MCP JSON-RPC and SSE endpoints enforce standard `Authorization: Bearer <TOKEN>` HTTP headers. For header-less SSE EventSource connections, clients exchange their Bearer token for a short-lived (60s), single-use Ephemeral Stream Ticket (`/auth/stream-ticket`) that is consumed and deleted immediately upon connection.
- **Consequence**: Zero credential leakage in HTTP access logs.

---

## ADR-007: Authoritative Production Database: Cloudflare D1 (SQLite Semantics)
- **Status**: Accepted (Reaffirmed)
- **Context**: Mailwarden is built Cloudflare-native. Introducing external PostgreSQL/Hyperdrive adds unneeded connection pooling, external billing dependencies, dialect divergence, and network hops. D1 provides serverless SQL with SQLite semantics, built-in disaster recovery, global read replication, and direct Worker binding.
- **Decision**:
  1. **Authoritative Production Database: Cloudflare D1**:
     - Cloudflare D1 is the authoritative production database.
     - Send idempotency is enforced via an atomic claim on unique constraint `(tenant_id, idempotency_key)` in `send_attempts` (`status = 'in_progress'`). Only one Worker instance acquires the send attempt before calling the provider.
     - Unavoidable external provider crashes (e.g. Gmail succeeds but worker dies before DB commit) are handled via explicit `uncertain` recovery and reconciliation rather than assuming database locks can solve non-transactional third-party APIs.
     - D1 batch transactions (`db.batch()`) provide atomic multi-statement mutations without connection pooling overhead.
  2. **Local Developer & Test Engine: Bun SQLite**:
     - Bun SQLite is preserved for local development, scripts, and CI unit/concurrency tests with identical SQLite semantics.
- **Consequence**: Zero-maintenance, ultra-fast edge data layer perfectly matched to the Cloudflare Workers execution model.

---

## ADR-008: Two-Stage Human Send Confirmation Boundary
- **Status**: Accepted
- **Context**: AI models exposed to untrusted email content (e.g. indirect prompt injection) must not be capable of manufacturing human authorization to dispatch emails autonomously.
- **Decision**:
  1. `request_send_approval`: Minted by AI or system in `status: "pending"` with draft payload hash, expiration, and confirmation nonce. Returns a preview card requiring human verification.
  2. `confirm_send_approval` (or `POST /api/approvals/:id/confirm`): Strictly required to transition approval to `status: "confirmed"` via explicit human user action.
  3. `send_draft`: Aborts with `SendApprovalNotConfirmedError` if invoked on an unconfirmed or pending challenge.
- **Consequence**: Mathematical separation between AI draft generation and human dispatch authority.

---

## ADR-009: Standards-Based OAuth 2.0 with PKCE (RFC 8414 & RFC 6749) for ChatGPT & MCP Clients
- **Status**: Accepted
- **Context**: Commercial and multi-user deployments connecting ChatGPT Actions or remote MCP clients require standardized OAuth 2.0 authorization with dynamic client validation.
- **Decision**:
  1. Expose `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` discovery metadata.
  2. Implement `GET /oauth/authorize` & `POST /oauth/authorize` with PKCE `S256` code challenge verification and 5-minute single-use authorization codes.
  3. Implement `POST /oauth/token` issuing scoped JWT access tokens with audience/issuer binding.
- **Consequence**: Seamless production onboarding for ChatGPT Actions and Claude Desktop while maintaining strict tenant-scoped principal derivation.
