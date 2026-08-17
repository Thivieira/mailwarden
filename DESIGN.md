# Design

**shadcn/ui, New York style.** Mailwarden's visual world, recorded from the built pages.

Chosen by the user (2026-08-16), replacing The Hotel Key Card. The trade was made
knowingly: this is the most widely-used look in current software, so it reads as familiar
and trustworthy rather than distinctive.

The distinctness pass (2026-08-17) kept those bones and gave them an identity, because
familiar had shaded into anonymous. Four things are Mailwarden's alone, and they are what
to protect when this system is edited:

1. **The seal.** An authored shield whose body is also an envelope — one outline doing
   both jobs, with the flap struck across it. It replaced a stock Lucide `key-round`.
2. **Material, not colour, carries polarity.** What the assistant *can* do sits on a
   raised white card. What it can *never* do is pressed into the page: muted ground,
   inset shadow, no lift. Locked things do not float.
3. **No background texture.** Ledger rules were tried here and removed at the user's
   request (2026-08-17), as was the dot field before them. The identity does not need a
   pattern behind it.
4. **The browser's own surfaces are themed** — caret, scrollbar, selection, underline
   offset, tabular numerals. These ship with defaults belonging to no design system.

The favicon is the deliberate exception: it stays Lucide's `key-round` on the neutral
swatch at the user's request (2026-08-17), so the tab icon and the header mark differ.

## The look is shadcn's; the runtime is not

Kobalte (the Solid equivalent of Radix, which is React-only) and Tailwind are
client-side. **These pages ship one hash-pinned script and nothing else** (see "The one
script" below), work with JS disabled, and every page but the authorize page forbids script
entirely. So the same visual language is expressed in plain CSS in `src/ui/tokens.ts`.

When the settings app is built it uses the real thing: SolidStart v2 + Kobalte +
`shadcn-solid`, `new-york` style. These tokens are shadcn's own, so the two will match.

## Tokens

`src/ui/tokens.ts` uses shadcn's token *names and structure*, in oklch, light and dark via
`prefers-color-scheme`. The values are Mailwarden's, which is what shadcn's theming
layer is for. Running shadcn's stock neutral ramp threw the identity away; the ramp is
warmed toward paper instead of pure gray, and the primary is the navy.

Hues are held constant per family so the ramp stays coherent: **navy 245, paper 85,
brass 82, green 160, red 27.**

| | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.988 0.004 85)` | `oklch(0.17 0.016 245)` |
| `--foreground` | `oklch(0.21 0.018 245)` | `oklch(0.97 0.005 85)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.215 0.019 245)` |
| `--primary` | `oklch(0.34 0.062 245)` | `oklch(0.7 0.105 245)` |
| `--muted-foreground` | `oklch(0.505 0.018 245)` | `oklch(0.72 0.02 245)` |
| `--border` | `oklch(0.905 0.007 85)` | `oklch(1 0 0 / 12%)` |
| `--destructive` | `oklch(0.505 0.15 27)` | `oklch(0.68 0.16 27)` |
| `--success` | `oklch(0.5 0.095 160)` | `oklch(0.72 0.13 160)` |
| `--brass` | `oklch(0.56 0.09 82)` | `oklch(0.75 0.1 82)` |

In dark mode the primary lifts to a legible blue rather than inverting to white the way
shadcn's neutral base does. A brand primary has to stay the brand.

`--brass` is the single brand accent and appears on the header mark and nowhere else, the
same rule the previous world held.

Measured contrast (light): body 17.1:1, muted text 5.7:1, card descriptions 5.9:1,
primary button 11.2:1, success 5.7:1, destructive 6.3:1, brass 4.5:1. All pass AA; re-measure
if the ramp is retuned.

`--radius: 0.625rem` with `sm`/`md`/`lg`/`xl` derived by `calc()`. Controls are `h-9`
(2.25rem). Focus is New York's signature: no outline, a border shift to `--ring` plus a
3px `color-mix` ring.

## Type

**Geist** (`@fontsource-variable/geist`) is Vercel's typeface: one variable file covering
every weight, ~29 KB, self-hosted at `/f/geist.woff2` with `immutable` caching and
preloaded.

Body is `0.9375rem` (15px), a step above shadcn's 14px default. That default is tuned for
dense desktop product UI; PRODUCT.md's reader is a consumer meeting this page once, so the
scale is lifted throughout: lede `1.0625rem`, card titles `1.0625rem`, row titles
`0.9375rem`, h1 up to `2.25rem`. Headings stay `600` with `-0.025em` tracking.

## Components

Cards carry the structure. That is a deliberate reversal of the previous world, which
refused them. In shadcn, cards *are* the system.

- **`.site-header`** — sticky, bordered, blurred. Carries the wordmark and the real host.
  The host line is the anti-forgery device and stays visible while scrolling. The wordmark
  is tracked caps (`0.11em`) so it reads as a mark rather than a line of body copy.
- **`details.card`** — the two permission lists fold. Native `<details>`/`<summary>`, since
  the CSP forbids script and a scripted accordion is unavailable *and* the wrong tool. The
  chevron rotates 180° on `[open]`; the summary is the whole row, so the focus ring is an
  inset ring on the row rather than an outline on the text.
- **`.subject`** — the account row shadcn uses to show who a grant is for: avatar
  initial, name, meta line, and a badge on the right.
- **`.rows`** — one permission per row inside a card, with a Lucide check or X.
- **`.alert`** — icon plus message, used for every outcome state.
- **`.letter-meta` / `.letter-body`** — the quoted email on the send-approval page.

Icons follow **Lucide's drawing spec exactly**: 24 viewBox, 2px stroke, round caps and
joins, rendered at 16px, `currentColor`. Authored as SVG rather than imported, since the
pages ship no JS, but they must stay spec-accurate so they match Lucide when the settings
app pulls the real library.

**Every power carries its own icon**, not a repeated check: `mail-open`, `pen-line`,
`send`, `archive`, `eye`, `bookmark`, `at-sign`. The icon is named on each entry in
`doors.ts` and drawn from `DOOR_ICONS` in `parts.tsx`. Keep those two in step, and note
that an unknown name falls back to a check rather than rendering nothing. Polarity is
carried by the card headings and the colour, so a topic icon costs no clarity. The "never"
list keeps a single `X` throughout: consistent negation reads faster than four different
negative glyphs.

There is no background texture. If one is ever wanted again it goes on `body::before`
anchored `left: 0; right: 0` — a viewport-width offset like `-50vw` paints past the
document and grows a horizontal scrollbar.

## MCP App UIs

Since 2026-08-17 there is a second rendering target: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview),
interactive UIs that render *inside the conversation* in Claude, ChatGPT and other hosts.
The first is the settings panel — the surface the product never had.

The two targets have opposite constraints and must not be confused:

| | Browser pages (`src/ui`) | MCP Apps (`src/mcp/ui`) |
|---|---|---|
| Script | one hash-pinned script | script *is* the app |
| Isolation | our own CSP | the host's sandboxed iframe |
| Assets | served from our origin | everything inlined; nothing fetchable |
| Renderer | Solid SSR, precompiled | `Bun.build` bundle in an HTML shell |

They share `src/ui/theme.ts` — the palette, the ramp and the seal — so a settings panel in
a conversation and the consent screen in a tab are visibly one product. Anything that
belongs to both goes in `theme.ts`; never fork the palette.

Adding an app is one entry in `src/mcp/ui/registry.ts`, one `<id>.client.ts`, and a tool
whose name matches. `build.ts` bundles it; `apps.gen.ts` is generated. Develop against
`bun run src/mcp/ui/preview.ts`, a mock host that implements the bridge handshake so you
never need to connect to Claude to iterate.

Two rules with teeth, both pinned by `tests/mcp_apps.test.ts`:

- **Every tool stays useful without its UI.** Most MCP clients render nothing, so
  `open_settings` returns the full settings as structured content. The app is an
  enhancement, never the only path.
- **Send approval never gets an app, and never gets a confirm tool.** The safety model
  rests on a human acting on a browser page carrying a nonce the model never sees. An app
  may legitimately *display* a pending draft, but the moment a tool exists that confirms an
  approval, the model can call it directly and the human is out of the loop. Show it, link
  to it, never confirm it from there.

## The one script

These pages shipped zero JavaScript until 2026-08-17. The show-password eye is the single
exception, and it exists because the CSS-only route is not merely unsupported but silently
broken: Chrome computes `-webkit-text-security: none` back to `disc` on a real password
input, while `CSS.supports()` still returns `true`. There is no runtime feature test that
catches it. The alternative — a `type="text"` field masked by CSS — reveals the credential
in cleartext whenever the stylesheet fails to load, which is a worse failure than no eye.

The script lives in `src/ui/peek.ts` and is admitted by a `sha256-` hash of its exact
bytes, generated at build time into `peek.gen.ts`. An injected `<script>` hashes
differently and is still refused, so the protection that matters on a credential page
holds. Rules:

- **Only the authorize page opts in**, via `renderPage(..., { peek: true })`. The
  send-approval page renders untrusted email content and keeps `default-src 'none'` with no
  `script-src` at all.
- **`renderPage` takes a boolean, not a script.** A caller can enable the one known script
  and can never hand the renderer arbitrary JavaScript.
- **The hash is generated, never written by hand.** A stale hash fails silently — the
  script just stops running. `tests/peek_script_csp.test.ts` recomputes it and fails on
  drift, and also asserts the approval page never gains a `script-src`.
- **The button ships `hidden`** and the script reveals it, so a blocked script leaves a
  plain password field rather than a dead control.

## Order on the authorize page

Sign-in comes **before** the permission lists (2026-08-17, user's call). Most people arrive
intending to approve, and 450px of scroll to reach the password field is the wrong tax; the
Allow button now lands inside the first viewport and the page is 38% shorter closed
(1959px → 1207px).

The consent tradeoff is real and is handled in the summaries, not by hiding anything: each
folded card states its **count and its guarantee** on the always-visible line — "7 things,
and nothing beyond them", "4 things Mailwarden's servers refuse outright". Someone who
never opens either list has still been told the size and the shape of what they are
granting. Keep it that way: a summary that degrades into a bare label ("Permissions") turns
a disclosure into a dark pattern.

## Language

Plain language is a functional requirement, not a style. **The raw scope identifiers never
reach the page.** `src/ui/doors.ts` groups the fourteen scopes into seven readable lines,
each carrying the scopes it covers so the grouping stays auditable.

Banned from user-facing copy: *vault*, *scope*, *token*, *digest*, *client*, *credential*,
*OAuth*, *MCP*. "Login secret" survives only as a parenthetical bridge to the provisioning
docs' term.

`SHUT_DOORS`, the "what it will never be able to do" list, is the most reassuring content on the
page. Every line must stay literally true against the invariants in
`docs/MAILWARDEN_SPEC.md`. Never add a line the server does not actually enforce.

## The letter carries untrusted content

Everything inside the send-approval letter can contain text that arrived in an email. It
must never be assembled by string interpolation.

That page previously built HTML by hand and interpolated `draft.subject`, `draft.textBody`,
`renderedSignature`, and recipient addresses unescaped, with no CSP, on a page that also
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
