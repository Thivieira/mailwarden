# Universal Mail Provider Architecture

Mailwarden connects email, regardless of where it lives.

Email infrastructure in modern organizations is heterogeneous: teams use Google Workspace, Microsoft 365, generic IMAP/SMTP hosting (cPanel, Plesk, Dovecot, Postfix), secure providers (Proton), or private on-premise mail servers. Mailwarden normalizes all of these into a unified, secure intelligence and automation runtime.

---

## 1. Provider Taxonomy & Connectivity Paths

Mailwarden routes email traffic through two primary connectivity topologies depending on provider architecture and network reachability:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          Mailwarden Cloud                              │
└───────┬───────────────────────────────┬────────────────────────┬───────┘
        │                               │                        │
        │ 1. Native REST OAuth          │ 2. Direct TLS IMAP/SMTP│ 3. Signed Gateway Request
        ▼                               ▼                        ▼
┌──────────────────┐            ┌───────────────┐     ┌─────────────────────┐
│ Google Workspace │            │ Standard IMAP │     │  Mailwarden Bridge  │
│  Microsoft 365   │            │ cPanel / Dovecot│    │  (Relay Agent / LAN)│
└──────────────────┘            └───────────────┘     └──────────┬──────────┘
                                                                 │
                                                       ┌─────────┴─────────┐
                                                       ▼                   ▼
                                               ┌───────────────┐   ┌───────────────┐
                                               │ Proton Bridge │   │ Private IMAP  │
                                               │  (127.0.0.1)  │   │  (Firewalled) │
                                               └───────────────┘   └───────────────┘
```

1. **Native REST OAuth (`gmail`, `outlook`)**:
   - Direct connection from Mailwarden Cloud to Google and Microsoft REST APIs.
   - Uses OAuth 2.0 PKCE, granular least-privilege scopes, and automatic token refresh.
   - High sync throughput, push notifications, and native search syntax.

2. **Generic IMAP/SMTP (`imap`)**:
   - Direct TLS (Port 993/465) or STARTTLS (Port 143/587) connections for publicly reachable mail servers.
   - Supports username/password and app-passwords.
   - Incremental UID synchronization with folder discovery and MIME normalization.

3. **Bridge Relay Connectors (`proton`, `private_imap`, `private_smtp`)**:
   - Outbound-only Cloudflare Tunnel connecting Cloud to customer-controlled Mailwarden Bridge daemons.
   - Connects to local Proton Mail Bridge or firewalled/on-premise mail servers unreachable from the public Internet.
   - Fully optional: Google, Microsoft, and public IMAP users never need Bridge.

---

## 2. Provider Capability Model

Providers declare their exact capabilities to Mailwarden via `MailProviderCapabilities`:

```typescript
export interface MailProviderCapabilities {
  read: boolean;
  search: boolean;
  folders: boolean;
  labels: boolean;
  threads: boolean;
  attachments: boolean;
  send: boolean;
  drafts: boolean;
  archive: boolean;
  flags: boolean;
  incrementalSync: boolean;
  nativeOAuth: boolean;
}
```

### Provider Feature Matrix

| Feature | Google Workspace (`gmail`) | Microsoft 365 (`outlook`) | Generic IMAP/SMTP (`imap`) | Proton (`proton`) |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | OAuth 2.0 | OAuth 2.0 | Password / App-Password | Bridge Password |
| **Organization** | Labels & Mailbox Categories | Folders & Categories | Standard Folders (RFC 6154) | Folders & Labels |
| **Threading** | Native Provider Threads | Native Conversation IDs | Inferred (`In-Reply-To`/`References`) | Inferred via Bridge |
| **Incremental Sync** | History ID | Delta Links | UIDValidity / UID Range | UIDValidity / UID Range |
| **Search Engine** | Google Search Syntax | Graph Filter / Search | IMAP Search / Mailwarden Index | Bridge Search / Mailwarden Index |
| **Draft Creation** | Gmail Drafts API | Graph Drafts API | Local Stored Draft | Bridge Drafts |
| **Outbound Transport**| Gmail Send API | Graph Send API | Authenticated SMTP | Bridge Authenticated SMTP |
| **Network Path** | Direct Cloud REST | Direct Cloud REST | Direct Cloud TCP / Bridge | Mailwarden Bridge Daemon |

---

## 3. Universal Provider Discovery

When a user enters an email address (e.g. `alice@acme.com`), `ProviderDiscoveryService` automatically inspects the domain to detect the optimal provider and settings:

```text
alice@acme.com
     │
     ├── 1. Known Domain Dictionary (e.g. gmail.com, fastmail.com, icloud.com)
     │
     ├── 2. DNS MX Records via Cloudflare DNS-over-HTTPS (DoH)
     │      ├── Google Workspace detected (aspmx.l.google.com) ──> Steer to Google OAuth
     │      ├── Microsoft 365 detected (protection.outlook.com) ──> Steer to Microsoft OAuth
     │      └── Proton Mail detected (mail.protonmail.ch) ────────> Steer to Proton Bridge
     │
     ├── 3. Mozilla ISPDB / Autoconfig XML Query
     │      └── Discovers IMAP/SMTP host, port, socketType (SSL/STARTTLS)
     │
     └── 4. Standard Convention Heuristics Fallback
            └── imap.acme.com (993 SSL) / smtp.acme.com (465/587 SSL/STARTTLS)
```

### Safety & Native OAuth Steering

If Google Workspace or Microsoft 365 is detected for a custom corporate domain, Mailwarden proactively steers the user toward **Native OAuth** rather than basic IMAP password auth. This provides:
- Single Sign-On (SSO) compliance.
- 2FA compatibility without requiring individual app passwords.
- Token revocation and auditability directly within Google Admin or Entra ID.

---

## 4. Normalization & Content Sanitization

Regardless of the incoming format (MIME RFC 822 source, Microsoft Graph JSON, or Google REST payload), messages are parsed and normalized into `NormalizedEmail`:

- **Sender & Recipient Extraction**: Parsed into `{ name?: string; address: string }` with lowercase normalization.
- **Body Sanitization**: HTML is stripped of tracking pixels, remote executable scripts, and CSS exfiltration vectors via `sanitizeEmailContent()`.
- **Classification & Signals**: Automatic extraction of `list-unsubscribe`, `auto-submitted`, OTP expiry detection, and priority ranking.
- **Folder Mapping**: Standardized into `inbox`, `sent`, `drafts`, `trash`, `spam`, `archive`, or `custom` using RFC 6154 special-use flags and localized name matching.

---

## 5. Outbound Mail & Human Safety Invariants

Mailwarden adheres to strict safety invariants for outbound communications:

1. **Mutations Switch (`MAILBOX_MUTATIONS_ENABLED=false`)**:
   - In standard mode, all message sending is simulated (`simulated: true`). Zero network packets are dispatched to SMTP or REST endpoints.
2. **Explicit Human Confirmation**:
   - Outbound drafts require a two-step human approval workflow (`requestSendApproval` &rarr; review payload hash &rarr; `confirmSendApproval`).
   - AI models and autonomous agents are architecturally prohibited from dispatching emails autonomously.

---

## 6. Multi-Tenant Envelope Encryption

Stored provider credentials (OAuth tokens, refresh tokens, IMAP passwords, Bridge secrets) are encrypted using AES-GCM envelope encryption via `encryptionService.encryptJson()`:

- **Key Derivation & Rotation**: Primary encryption keys are versioned (`KEY_VERSION`).
- **Additional Authenticated Data (AAD)**: Ciphertext is authenticated with `{ tenantId, userId }` as AAD. A ciphertext encrypted in Workspace A cannot be decrypted or used in Workspace B, preventing cross-tenant credential escalation.

---

## 7. Cloudflare Worker Runtime & Bridge Fallback

Direct TCP socket communication from Cloudflare Workers uses `nodejs_compat` (`connect()` / raw sockets). While bundling succeeds, serverless execution boundaries require runtime validation:

```text
Direct Cloud Mode:
Cloudflare Worker ──(Raw TLS TCP Socket)──> Public IMAP/SMTP Server (Port 993/465/587)

Transparent Relay Fallback:
If raw socket lifetime or firewall prevents direct connection:
Cloudflare Worker ──(Signed Gateway Request)──> Mailwarden Bridge ──> IMAP/SMTP Server
```

---

## 8. Managed Relay vs Private Network Security Boundaries

To prevent generic IMAP capabilities from compromising managed infrastructure, Mailwarden enforces strict boundary separation:

1. **Managed Proton Relay**:
   - `destination = loopback only` (`127.0.0.1`, `::1`, `localhost`).
   - Managed directly by Mailwarden Cloud tunnels; absolutely no routing to arbitrary LAN IPs.
2. **Private Network IMAP/SMTP**:
   - `deployment = self-hosted organization Bridge only`.
   - `destination = explicit administrator-approved host/port allowlist`.

---

## 9. Product & Pricing Architecture

Infrastructure fees align with infrastructure Mailwarden actually operates, rather than the customer's email brand:

- **Google Workspace Team**: Team seat pricing (Direct Native OAuth).
- **Microsoft 365 Team**: Team seat pricing (Direct Native OAuth).
- **Public IMAP/SMTP Team**: Team seat pricing (Direct IMAP/SMTP).
- **Proton Mail Team**: Team seats + optional Managed Relay infrastructure fee.
- **Private / On-Premises Mail (Enterprise)**: Team/Enterprise seats with self-hosted Bridge.
