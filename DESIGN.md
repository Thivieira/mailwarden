# Design

The Fingerprint Block — Mailwarden's visual world, recorded from the built pages.

## Thesis

Authorization rendered in the notation this audience already uses to answer "is this
really the thing I think it is?" — the key fingerprint. It refuses the centered card on
gray: there is no card, no logo lockup, and the fingerprint is the page's largest object.

The hardest job these pages do is proving they are not forgeries. An auth form reached
from a chat client is exactly what an attacker would clone, so the design spends itself
on verifiability rather than on welcome.

## Platform and rendering

Solid components in `src/ui/*.tsx`, compiled by `src/ui/build.ts` through
`babel-preset-solid` in SSR mode into sibling `*.gen.js`, rendered to string by
`src/ui/render.ts`, wrapped by `src/ui/document.ts`.

**Zero client JavaScript ships.** The pages must work with JS disabled, and the CSP
forbids script entirely. CSS is inlined in the document; the favicon is a data URI.
Nothing is fetched. The authorize page is ~12 KB in one request.

`renderPage` always returns a real `Response`. Elysia drops a route-set `Content-Type`
on string returns under Cloudflare Workers, which is what made these pages render as
literal source; on `provider-connect` it emitted a malformed `text/html, text/plain`.

## Color

Restrained: near-black ground, bone ink, one accent reserved for state.

| Token | Value | Role |
|---|---|---|
| `--ground` | `#0E1110` | Page ground |
| `--raised` | `#151917` | Block interiors |
| `--rule` | `#2A302D` | Hairlines, table borders |
| `--rule-strong` | `#3D453F` | Input borders |
| `--ink` | `#E4E8E3` | Body and headings |
| `--ink-muted` | `#8A938C` | Labels, secondary prose (5.9:1 on ground) |
| `--granted` | `#5BE0A8` | Granted state, submit, caret, selection |
| `--denied` | `#FF6B4A` | Denied state |
| `--held` | `#E8C46A` | Approval-required and dry-run state |

Dark is chosen from the use scene, not the category: a technical operator mid-flow in an
AI client, verifying a key fingerprint. Fingerprint verification lives in a terminal.

**The accent never appears on chrome.** It marks state, the primary action, the caret,
and text selection. Nothing else.

## Type

- Prose: system UI stack. Operate-mode surfaces are well served by workhorse UI faces,
  and a zero-request page cannot justify a webfont for a 30-second interstitial.
- Monospace (`ui-monospace` stack): used **only** where bytes are checkable — randomart,
  digests, scope identifiers, hostnames, field labels, the submit. Never for prose.
- `font-variant-numeric: tabular-nums` globally, so digests and counts align.
- Headings `text-wrap: balance`, tracking `-0.02em`, body measure capped at `68ch`.

## Composition

Not cards. A ruled manifest: full-bleed ground, left-aligned, hairline-separated blocks.

1. **Origin strip** — the first thing on the page is where the page actually is. A rule
   under it, the host in mono. This is functional verification data, not an eyebrow.
2. **Fingerprint block** — framed randomart beside the request digest and its facts.
3. **Scope manifest** — a ruled table, one row per granted power.
4. **Entry** — labeled mono inputs, max `34rem`, struck submit at bottom-left.
5. **Note** — how to use the fingerprint, above a closing rule.

## The randomart

`src/ui/randomart.ts` implements OpenSSH's drunken-bishop walk exactly as `ssh-keygen -lv`
draws it: a 17×9 field, four moves per byte, `S` at the start cell and `E` at the walk's
end, framed by `+---[MAILWARDEN]---+` / `+-----[SHA256]-----+`.

It is drawn from the SHA-256 of the actual attested bytes — client id, redirect URI, PKCE
challenge, scopes. It is a real fingerprint rendering, **never decoration**. Do not draw
it from anything other than the bytes being attested, and do not frame it without borders:
unframed rows read as stray characters.

**It is the largest object on the page**, and must stay that way — the heading sits back
at working scale so the artifact leads. A build where the `h1` outweighs the art has
opted out of the thesis.

Density in randomart is meaning, so the field is drawn as a topography via `frameCells()`
rather than flat text:

| Tone | Color | Cells |
|---|---|---|
| `frame` | `--rule-strong` | The `+---[...]---+` border |
| `sparse` | `#4E5651` | Low visit counts — these recede |
| `dense` | `--ink` | `B` and above — the walk's peaks |
| `landmark` | `--granted` | `S` and `E` only |

Tight leading (`1.02`) with open tracking (`0.1em`) pulls the cells toward square so the
field reads as woven rather than as a paragraph. The `<pre>` takes `overflow: visible`
and its grid column is `max-content`; an `auto` column shrinks below content and clips
the frame's right edge behind a spurious scrollbar.

## State

State is carried by the **word** first and hue second, so every state reads correctly
without color:

| State | Word | Meaning |
|---|---|---|
| `granted` | `GRANTED` | Conferred outright |
| `approval` | `APPROVAL REQUIRED` | `mail.send` only — gated on an exact-payload hash |
| `dryrun` | `DRY RUN` | Mailbox mutation simulated while `MAILBOX_MUTATIONS_ENABLED=false` |

These must stay factually true. An earlier draft marked four scopes "NEEDS APPROVAL" when
only `mail.send` is approval-gated; overstating protection on a security page is a defect,
not a flourish.

## Responsive

One breakpoint that matters: below `46rem` the three-column manifest squeezes to one word
per line, so every row becomes a stacked record (`caption` must join the `display: block`
list or it shrink-wraps). Below `34rem` the fingerprint block stacks and the art steps down
a size. Long URLs use `overflow-wrap: anywhere`, not `word-break: break-all`.

## Browser surfaces

Themed rather than left to defaults: text selection, caret color, scrollbar colors,
focus-visible ring (2px `--granted`, 2px offset), `color-scheme: dark`, `accent-color`.

## Refused

No cards as page structure. No gradients, no glass, no glow, no shadows. No radius above
2px. No kicker above a heading. No emoji or Unicode glyphs standing in for icons. No
monospace as a costume for prose.

## Extending to the settings app

These components are ordinary Solid and import into SolidStart v2 unchanged. When the
settings dashboard lands, reuse `tokens.ts`, `parts.tsx`, and the manifest/record table
grammar; hydrate only the regions that genuinely hold state. The boundary pages stay
zero-JS on the Worker — do not hydrate the authorize form.
