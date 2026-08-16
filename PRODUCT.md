# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase answers this: TypeScript on Bun, Elysia HTTP layer, deployed as a
single Cloudflare Worker (`src/worker.ts`) with D1 storage and a `*/15 * * * *` cron
trigger. Browser-facing pages are server-rendered strings returned from Elysia routes.

Settled 2026-08-16: the settings dashboard will be built on **SolidStart v2 + Kobalte +
shadcn-solid** (`new-york` style). Kobalte is the Solid equivalent of Radix, which is
React-only; `shadcn-solid` is the port built on it. Those are interactive client
components and are **not** installed yet — the settings app does not exist, and adding
Tailwind plus a component runtime before there is a page to put them on would be
scaffolding for its own sake. Install when the first settings screen starts.

The four boundary pages stay server-rendered with zero client JavaScript. They carry no
reactive state, and the authorize page must keep `script-src 'none'` because it takes
credentials. They borrow New York's craft-level refinements in CSS instead (see
DESIGN.md), which needs no runtime.

## Users

**Design baseline (set 2026-08-16): general consumers, non-technical by default.** Assume
the typical user has never heard of OAuth, MCP, scopes, or tokens, and has no mental model
for "authorizing a client." That is the baseline every surface is designed for, not an
accommodation layered on afterward.

They run several email accounts across personal and work life (Gmail, Outlook, Proton) and
do not want to live inside an inbox. Their job is to find out what actually needs them,
understand history with a person, and prepare replies — by talking to an AI assistant
rather than triaging mail by hand.

At a boundary moment their question is never "is this cryptographically sound." It is:
**is this safe, what exactly can it do, and can I undo it?** Design answers that, in words
they already use.

Operationally the beta is still three named people — the deployment owner and two invited
buddies, each with a completely separate private vault, no public signup (see
`docs/PRIVATE_BETA.md`). The buddies are not developers. What is built stays inside the
beta's scope; who it is designed for is the general consumer above.

Critically, **the product's primary interface is not this web UI.** Daily use happens
inside Claude (and later ChatGPT) over MCP. The web pages exist only at boundary moments:
authorizing the AI client, connecting a mail provider, and confirming what happened.

## Product Purpose

Mailwarden is an AI-native email operating layer. It connects a person's email accounts
to their conversational AI client via the Model Context Protocol, so they can ask what
matters, see who is waiting on them, understand conversation history, and prepare
responses without opening an email client.

Success for the beta is explicitly not "the architecture looks good." It is all three
people independently connecting real inboxes and naturally using Mailwarden in Claude for
cross-account summaries, attention prioritization, sender/thread context, persistent
personal rules, drafting, human-approved sending, and privacy controls.

## Positioning

The mechanism a neighboring product could not truthfully copy:

> **AI determines meaning. Code determines permission.**

The AI is allowed to interpret importance, intent, relationships, urgency, and summaries.
Deterministic server-side code — never the model, never MCP tool arguments — decides
authentication, tenant boundaries, account ownership, scope validation, send approvals,
and every destructive action. Sending requires human approval bound to a SHA-256 hash of
the exact canonical payload; any edit invalidates the approval.

The second differentiator is honesty about incompleteness: when the Proton connector is
offline, Mailwarden says so rather than silently returning a partial cross-account
summary.

## Operating Context

Daily use is conversational, inside Claude. The web surfaces are four boundary moments,
all server-rendered by the Worker:

1. `GET /oauth/authorize` — the sign-in form where a beta user types their email and
   vault login secret to authorize an AI client. Reached from inside Claude's connector
   setup flow. The single highest-trust moment in the product.
2. `POST /oauth/authorize` (401) — authorization denied on bad credentials.
3. `GET /auth/callback/{google,microsoft}` — the landing page after connecting a mail
   provider, reporting the connected address and first sync result, or the failure.
4. Management pages in `src/http/routes/management.ts`.

Every one of these is a tab the user opens once, reads, and closes — often returning to
Claude immediately after. They are interstitials, not destinations.

Deployment: `https://mailwarden.corenet.workers.dev`. Mailbox mutations are disabled by
default during beta (`MAILBOX_MUTATIONS_ENABLED=false`).

## Capabilities and Constraints

- Providers: Google Workspace/Gmail and Microsoft 365/Outlook via OAuth 2.0 PKCE; Proton
  Mail via a locally-run Proton Mail Bridge connector on the user's own machine.
- Onboarding presets: Balanced (default), Safe, Inbox Zero. Never permanently deletes.
- Conversational rules compile into persistent structured policy records resolved by a
  strict precedence hierarchy; user-defined rules always outrank inferred model behavior.
- Multilingual: English and Portuguese (PT-BR) are both first-class in conversation.
- Technical constraint: pages are strings returned from a Cloudflare Worker. Elysia drops
  a route-set `Content-Type` on string returns, so HTML must be returned as a real
  `Response` (see `renderBrowserHtml` in `src/http/routes/oauth.ts`).
- Security constraint: the authorize page is a credential-entry form. It must function
  with no JavaScript and should keep a restrictive CSP. No third-party origins.
- Explicitly not built during beta: public signup, billing, pricing, org administration,
  shared inboxes, seat management, enterprise SSO, large settings dashboards, automatic
  AI sending.

## Brand Commitments

None binding. Confirmed with the user on 2026-08-16: the 🛡️ shield in the README and the
slate/emerald palette in the current pages are scaffolding placeholders, not deliberate
identity. Treat the incumbent look as evidence and anti-reference.

The name "Mailwarden" is fixed. Its meaning — a warden that guards and watches on your
behalf, holding a boundary — is product truth and available to the identity.

## Evidence on Hand

- `README.md` — product narrative and real example utterances in English and PT-BR.
- `docs/MAILWARDEN_SPEC.md` — ten numbered security invariants, full MCP tool catalog.
- `docs/PRIVATE_BETA.md` — beta structure, vault boundary, success criterion.
- `docs/DECISIONS.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/PERSONAL_SAAS_ARCHITECTURE.md`.
- 70 passing automated tests.

No customers, testimonials, press, benchmarks, pricing, or usage numbers exist. There are
three beta users, two of whom have not yet been provisioned. Future work must not
fabricate social proof, logos, or metrics.

## Product Principles

1. **Permission is code, meaning is AI.** Never let interface work imply the model holds
   authority it does not have.
2. **The boundary moment deserves the most care.** The web surfaces are rare and
   high-trust; each one is someone deciding whether to hand over their inbox.
3. **Honest about incompleteness.** Say what is missing or offline rather than presenting
   a confident partial answer.
4. **Conversation is the product; the interface is the doorway.** Return the user to
   their AI client quickly rather than competing for their attention.
5. **Safe by default, reversible by design.** Conservative defaults, dry-run first, never
   permanent deletion.

## Accessibility & Inclusion

No formal standard was established with the user. Product-derived requirements: the
authorize page must work without JavaScript, must be operable by keyboard alone, and must
support password managers (correct autocomplete semantics on the credential fields).
Copy must be translatable — PT-BR is a confirmed first-class language.

Plain language is an accessibility requirement here, not a style preference. A permission
a user cannot read is a permission they cannot meaningfully grant, and the non-technical
baseline above makes jargon a functional defect: *vault*, *scope*, *token*, *digest*, and
*client* are all words to replace rather than explain.

The anti-forgery job gets harder with this audience, not easier — non-technical users are
the ones cloned auth pages actually catch. Verification must be replaced with something a
normal person can act on, never simply removed.
