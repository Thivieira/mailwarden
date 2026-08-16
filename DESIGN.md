# Design

The Hotel Key Card — Mailwarden's visual world, recorded from the built pages.

Replaces The Fingerprint Block (2026-08-16), which was built for a technical operator who
reads key fingerprints. PRODUCT.md's audience changed to general consumers, non-technical
by default, and that premise did not survive the change.

## Thesis

The page is the printed sleeve a front desk hands you with a key: which doors it opens,
which it never opens, where the desk is, and that you can hand it back any time.

It refuses the centered consent card with its Allow and Deny buttons — the layout every
phishing kit ships, and the reason users have stopped reading these pages.

## The three questions

Every surface answers the questions a nervous non-technical person actually has, in that
order. Anything that answers none of them does not belong on the page.

1. **Is this safe?** — the printed host in the band, and the address-bar check.
2. **What exactly can it do?** — what this key opens, and what it never opens.
3. **Can I undo it?** — "works until you hand it back", stated on the card and again at
   the end.

## Language

Plain language is a functional requirement here, not a style. **The raw scope identifiers
never reach the page.** `src/ui/doors.ts` groups the fourteen scopes into seven doors a
person can read, each carrying the scopes it covers so the grouping stays auditable.

Words that are banned from user-facing copy: *vault*, *scope*, *token*, *digest*,
*client*, *credential*, *OAuth*, *MCP*. "Login secret" survives only as a parenthetical
bridge to the term used in provisioning docs.

`SHUT_DOORS` is the most reassuring content on the page and every line must stay
literally true against the invariants in `docs/MAILWARDEN_SPEC.md`. Never add a line there
that the server does not actually enforce.

## Color

Restrained, on printed stock. Light is chosen from the use scene: someone at a desk in
daylight who wants reassurance, where a printed document reads calmer than a terminal.

| Token | Value | Role |
|---|---|---|
| `--stock` | `#EFEDE8` | Printed paper ground |
| `--stock-deep` | `#E3E0D8` | Outcome panels |
| `--card` | `#FFFFFF` | The key card, and inputs |
| `--ink` | `#14384F` | Printed navy — text, band, primary action |
| `--ink-soft` | `#5A6E7E` | Secondary prose and notes |
| `--rule` | `#C9C6BD` | Hairlines |
| `--brass` | `#9A7628` | The card's stripe, and nothing else on the page |
| `--opens` | `#2E6B4F` | A door the key opens |
| `--shut` | `#A3402F` | A door it never opens |

The navy band is a committed field at page scale, not a header bar — it owns its region
and the wordmark reverses out of it.

## Type

- Display: **Archivo** (`@fontsource/archivo`), weights 400 and 600, self-hosted and
  served from `/f/` by `src/http/routes/fonts.ts` with `immutable` caching. A grotesque
  drawn from American gothic signage — plain and confident rather than luxurious.
- Body: system UI stack.
- **No monospace anywhere.** It was the loudest techy signal in the previous world.

The face is the one extra request these pages make. It is same-origin, ~16 KB per weight,
`font-display: swap`, and the 600 weight is preloaded.

## Components

- **`.band`** — full-bleed navy, wordmark left, the real host right. The host line is the
  anti-forgery device and is printed loud, never whispered in a footer.
- **`.keycard`** — landscape proportion, a punched slot top-right, the brass stripe along
  the bottom, one soft shadow. Those three details are what separate a key card from a
  box; a version without them reads as a generic panel.
- **`.doors`** — ruled list, one door per row, an authored SVG key per line and the same
  key struck through for what is refused. Icons are drawn at one stroke weight (1.6,
  round caps), never glyphs or emoji.
- **`.signin`** — the rule spans the sheet, the fields inside are held to `27rem`.
- **`.letter`** — the send-approval page's quoted document: recipients, subject, and body
  set apart in a bordered card with `white-space: pre-wrap`, visibly *not* the page's own
  voice.

### The letter carries untrusted content

Everything inside `.letter` can contain text that arrived in an email. It must never be
assembled by string interpolation.

This page previously built its HTML by hand and interpolated `draft.subject`,
`draft.textBody`, `renderedSignature`, and recipient addresses unescaped, with no CSP —
on a page that also carries the `confirmationNonce` in a hidden input, and whose POST
endpoint accepts that nonce *without a session*. An email carrying markup, quoted into a
draft, could therefore have approved its own send with no human involved, defeating both
the exact-payload invariant and the prompt-injection invariant.

It renders through Solid now, which escapes every interpolation, behind `renderPage`'s
script-forbidding CSP. `tests/approval_page_injection.test.ts` pins this. Never route
this page around the component layer.

## State

Carried by the word and the drawn mark before the hue, so every state survives without
color:

| State | Mark | Meaning |
|---|---|---|
| opens | key | Granted outright |
| shut | key, struck through | Never permitted, enforced server-side |
| off | key, muted, plus its own line | Simulated while `MAILBOX_MUTATIONS_ENABLED=false` |

## Rendering

Solid components in `src/ui/*.tsx`, compiled by `src/ui/build.ts` through
`babel-preset-solid` in SSR mode into sibling `*.gen.js`. Zero client JavaScript. The
pages work with JS disabled and the CSP forbids script entirely.

`renderPage` always returns a real `Response`: Elysia drops a route-set `Content-Type` on
string returns under Cloudflare Workers, which is what made these pages render as literal
source.

## Refused

No dark ground. No monospace. No cards-as-page-structure. No gradients, glass, or glow.
No kicker above a heading. No emoji or Unicode standing in for icons. No jargon.

## Extending to the settings app

These are ordinary Solid components and import into SolidStart v2 unchanged. Reuse
`tokens.ts`, the door-list grammar, and the record table; hydrate only regions that hold
real state. The boundary pages stay zero-JS on the Worker — never hydrate the sign-in form.
