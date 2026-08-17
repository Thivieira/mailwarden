# Design

**shadcn/ui — New York.** Mailwarden's visual world, recorded from the built pages.

Chosen by the user (2026-08-16), replacing The Hotel Key Card. The trade was made
knowingly: this is the most widely-used look in current software, so it reads as familiar
and trustworthy rather than distinctive. Familiar and effective is a legitimate
destination.

## The look is shadcn's; the runtime is not

Kobalte (the Solid equivalent of Radix — Radix itself is React-only) and Tailwind are
client-side. **These pages ship zero JavaScript**, work with JS disabled, and the CSP
forbids script entirely because the sign-in page takes credentials. So the same visual
language is expressed in plain CSS in `src/ui/tokens.ts`.

When the settings app is built it uses the real thing: SolidStart v2 + Kobalte +
`shadcn-solid`, `new-york` style. These tokens are shadcn's own, so the two will match.

## Tokens

`src/ui/tokens.ts` carries shadcn's neutral palette **verbatim**, in oklch, light and dark
via `prefers-color-scheme`. Do not hand-tune these values — if they need to change, change
them to whatever shadcn ships, so the settings app and these pages stay identical.

| | Light | Dark |
|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |

`--success` is the one addition shadcn's neutral base does not define; it follows the same
oklch construction and is used only on the granted-permission check.

`--radius: 0.625rem` with `sm`/`md`/`lg`/`xl` derived by `calc()`. Controls are `h-9`
(2.25rem). Focus is New York's signature: no outline, a border shift to `--ring` plus a
3px `color-mix` ring.

## Type

**Geist** (`@fontsource-variable/geist`) — Vercel's typeface, one variable file covering
every weight, ~29 KB, self-hosted at `/f/geist.woff2` with `immutable` caching and
preloaded. Body is `0.875rem`, headings `600` with `-0.025em` tracking.

## Components

Cards carry the structure. That is a deliberate reversal of the previous world, which
refused them — in shadcn, cards *are* the system.

- **`.site-header`** — sticky, bordered, blurred. Carries the wordmark and the real host.
  The host line is the anti-forgery device and stays visible while scrolling.
- **`.subject`** — the account row shadcn uses to show who a grant is for: avatar
  initial, name, meta line, and a badge on the right.
- **`.rows`** — one permission per row inside a card, with a Lucide check or X.
- **`.alert`** — icon plus message, used for every outcome state.
- **`.letter-meta` / `.letter-body`** — the quoted email on the send-approval page.

Icons follow **Lucide's drawing spec exactly**: 24 viewBox, 2px stroke, round caps and
joins, rendered at 16px, `currentColor`. Authored as SVG rather than imported, since the
pages ship no JS, but they must stay spec-accurate so they match Lucide when the settings
app pulls the real library.

## Language

Plain language is a functional requirement, not a style. **The raw scope identifiers never
reach the page.** `src/ui/doors.ts` groups the fourteen scopes into seven readable lines,
each carrying the scopes it covers so the grouping stays auditable.

Banned from user-facing copy: *vault*, *scope*, *token*, *digest*, *client*, *credential*,
*OAuth*, *MCP*. "Login secret" survives only as a parenthetical bridge to the provisioning
docs' term.

`SHUT_DOORS` — "what it will never be able to do" — is the most reassuring content on the
page. Every line must stay literally true against the invariants in
`docs/MAILWARDEN_SPEC.md`. Never add a line the server does not actually enforce.

## The letter carries untrusted content

Everything inside the send-approval letter can contain text that arrived in an email. It
must never be assembled by string interpolation.

That page previously built HTML by hand and interpolated `draft.subject`, `draft.textBody`,
`renderedSignature`, and recipient addresses unescaped, with no CSP — on a page that also
carries the `confirmationNonce` in a hidden input, and whose POST endpoint accepts that
nonce *without a session*. An email carrying markup, quoted into a draft, could therefore
have approved its own send with no human involved.

It renders through Solid now, which escapes every interpolation, behind `renderPage`'s
script-forbidding CSP. `tests/approval_page_injection.test.ts` pins this. Never route this
page around the component layer.

## Rendering

Solid components in `src/ui/*.tsx`, compiled by `src/ui/build.ts` through
`babel-preset-solid` in SSR mode into sibling `*.gen.js`.

`renderPage` always returns a real `Response`: Elysia drops a route-set `Content-Type` on
string returns under Cloudflare Workers, which is what made these pages render as literal
source.
