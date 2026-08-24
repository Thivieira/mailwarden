# Handoff: Universal Mail Provider Architecture

**Author**: Gemini 3.7 Flash  
**Recipient**: Claude Opus 5 (Principal Owner)  
**Date**: 2026-08-24  
**Status**: Implementation Complete & Verified (283/283 tests passing, 0 typecheck errors, build green)

---

## 1. Overview & Architectural Realignment

Mailwarden has transitioned from a provider-specific triple (`Gmail | Microsoft | Proton`) to a **Universal Email Connectivity Platform**:

```text
Google Workspace / Gmail (Native OAuth)
Microsoft 365 / Outlook (Native OAuth)
Standard IMAP / SMTP (cPanel, Plesk, Dovecot, Postfix, Fastmail, Apple iCloud, etc.)
Proton Mail (via Mailwarden Bridge Daemon)
Private / On-Premise Mail Systems (via Mailwarden Bridge Connector)
```

### Core Architecture Invariant: Bridge is Optional
- Companies exclusively using Google Workspace or Microsoft 365 never touch or know about Mailwarden Bridge.
- Companies using standard public IMAP/SMTP connect directly from Mailwarden Cloud.
- Mailwarden Bridge serves as the dedicated secure connectivity agent for infrastructure unreachable from the public internet (local Proton Bridge on loopback, private LAN mail servers, or firewalled enterprise Dovecot/Exchange nodes).

---

## 2. Deliverables & Implemented Components

### A. Shared Contracts (`packages/contracts/src/index.ts`)
1. **`ProviderType`**: Extended to `"gmail" | "outlook" | "proton" | "imap" | "mock"`.
2. **`MailProviderCapabilities`**: Provider capability contract (`read`, `search`, `folders`, `labels`, `threads`, `attachments`, `send`, `drafts`, `archive`, `flags`, `incrementalSync`, `nativeOAuth`).
3. **`NormalizedFolder` & `MailFolderKind`**: Unified folder shape (`inbox`, `sent`, `drafts`, `trash`, `spam`, `archive`, `custom`).
4. **`RelayCapabilities` & `BridgeConnectorCapability`**: Generalized connector capability model (`proton`, `private_imap`, `private_smtp`).
5. **Discovery & Diagnostics Types**: `DiscoveredProviderConfig`, `ProviderDiscoveryConfidence`, `ServerEndpointConfig`, `ConnectionTestResult`.

### B. Database Schema (`packages/db/src/schema.ts`)
- `emailAccounts.provider` and `providerConnections.provider` enums updated to include `"imap"`.

### C. Generic IMAP & SMTP Providers (`src/providers/`)
1. **`ImapProvider` (`src/providers/imap.ts`)**:
   - Production IMAP client using `imapflow` and `mailparser`.
   - Folder discovery and classification (supporting standard RFC 6154 special-use attributes and multi-language folder naming).
   - Incremental UID synchronization.
   - Comprehensive `testConnection()` with diagnostic error taxonomy (`auth_rejected`, `server_unreachable`, `timeout`, `tls_failure`, `success`).
   - Content sanitization and tracker blocking via `sanitizeEmailContent()`.
2. **`SmtpProvider` (`src/providers/smtp.ts`)**:
   - Authenticated outbound transport using `nodemailer`.
   - Respects Mailwarden's safety invariant: `MAILBOX_MUTATIONS_ENABLED=false` simulates send without dispatching network packets.
3. **`ProviderFactory` (`src/providers/factory.ts`)**:
   - Automatically instantiates `ImapProvider` with AES-GCM decrypted credentials bound to `{ tenantId, userId }`.

### D. Universal Provider Discovery Service (`src/services/provider-discovery.ts`)
- **Known Provider Fast-Path**: Instant detection for Gmail, Outlook, Proton, iCloud, Fastmail, Yahoo, Zoho.
- **DNS-over-HTTPS (DoH) MX Inspection**: Queries Cloudflare 1.1.1.1 JSON API to detect Google Workspace (`aspmx.l.google.com`), Microsoft 365 (`mail.protection.outlook.com`), and Proton (`protonmail.ch`).
- **Native OAuth Steering**: Automatically steers custom business domains on Google Workspace or Microsoft 365 to one-click Native OAuth instead of IMAP passwords.
- **Mozilla ISPDB Autoconfig**: Queries `https://autoconfig.thunderbird.net/v1.1/{domain}` and parses XML configurations.
- **Standard Fallback Heuristics**: Suggests standard IMAP/SMTP host conventions when autoconfig is absent.

### E. HTTP API & Portal UI (`src/http/routes/` & `src/ui/`)
1. **Endpoints**:
   - `GET /api/connect/discover`: Real-time provider discovery for email address or domain.
   - `POST /api/connect/test`: Tests IMAP/SMTP credentials with diagnostic reporting.
   - `POST /api/connect/imap`: Connects and saves generic IMAP mailbox with envelope encryption.
   - `POST /portal/accounts/connect-imap`: Web route for Portal onboarding.
2. **Portal Interface (`src/ui/portal.tsx`)**:
   - Universal Provider Picker supporting Google, Microsoft, Proton, and Other Email (IMAP).
   - Responsive Connection Modal with live auto-detection and "Test Connection" diagnostics.
   - Distinctive badges for GMAIL, MICROSOFT, PROTON, and COMPANY / IMAP.

### F. Bridge Generalization (`apps/bridge/src/core/gateway.ts`)
- Updated `tlsOptionsFor` to preserve loopback verification for Proton Bridge while allowing TLS-validated non-loopback host connections for private on-premise relays.

---

## 3. Test Coverage & Verification

All test suites ran cleanly with 100% pass rate:

```bash
bun run ui:build && bun test && bun run typecheck && bun run build
```

- **Total Test Suites**: 38 files
- **Total Tests**: 284 passing (0 failing)
- **New Test Suites Added**:
  - `tests/provider_discovery.test.ts` (6 tests)
  - `tests/generic_imap_provider.test.ts` (7 tests - including Gateway mode)
  - `tests/smtp_transport.test.ts` (4 tests)
  - `tests/provider_neutral_architecture.test.ts` (3 tests)
- **TypeScript**: 0 errors
- **Wrangler Dry-Run**: Passed cleanly

---

## 4. Focused Integration & Acceptance Tasks for Claude Opus 5

1. **Integrate into Canonical Branch**:
   - Merge Gemini's provider contracts and adapters into the main integration branch and clean up any legacy provider contract shims.
2. **Staging Runtime Verification (Direct Worker Mode)**:
   - Deploy to staging Cloudflare Worker and exercise against a real public IMAP mailbox on Port 993 (TLS) and Port 143 (STARTTLS):
     ```text
     Staging Worker → Real IMAP server :993 / :143 → TLS handshake → Authenticate → Discover Folders → UID Sync → Fetch MIME → Normalize → D1 Persist → Surface in Portal
     ```
   - Separately verify SMTP connection/authentication with `MAILBOX_MUTATIONS_ENABLED=false` send simulation.
   - Note: In compatibility dates >= 2026-08-04, Workers `node:net` and `node:tls` support client sockets, but unsupported options throw. Keep TLS options minimal (`servername`, `rejectUnauthorized`).
3. **Gateway Mode Parity Verification**:
   - Verify the same IMAP mailbox can run via `mode: "gateway"` routed through Mailwarden Bridge, proving complete parity between direct and gateway modes.
4. **Auto-Discovery Route Verification**:
   - Verify that Google Workspace and Microsoft 365 domains steer toward 1-click Native OAuth, while ordinary business mail falls back to verified ISPDB or candidate IMAP settings.

---

## 5. Product Positioning & Commercial Model

### Unified Value Proposition
> **"Connect Gmail, Outlook, Proton, or virtually any business email account, then manage them together through one intelligent inbox layer."**

### Clean Pricing Architecture
Infrastructure fees align strictly with infrastructure Mailwarden actually operates, rather than the customer's email brand:
- **Google Workspace Team**: Team seat pricing (Direct Native OAuth).
- **Microsoft 365 Team**: Team seat pricing (Direct Native OAuth).
- **Public IMAP/SMTP Team**: Team seat pricing (Direct IMAP/SMTP).
- **Proton Mail Team**: Team seats + optional Managed Relay infrastructure fee.
- **Private / On-Premises Mail (Enterprise)**: Team/Enterprise seats with self-hosted Bridge.
