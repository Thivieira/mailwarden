/**
 * shadcn/ui — New York, carrying Mailwarden's own identity.
 *
 * The bones are shadcn's: oklch tokens, cards at radius-xl, h-9 controls, the 3px focus
 * ring. What makes the pages Mailwarden's rather than any shadcn app's lives in four
 * places, and they are the parts to protect when this file is edited:
 *
 *   1. The seal. An authored shield whose body is also an envelope, drawn to Lucide's
 *      spec so it sits in the icon system. It is the only brass on the page.
 *   2. Material, not colour, carries polarity. What the assistant CAN do sits on a raised
 *      white card. What it can NEVER do is pressed into the page - muted ground, inset
 *      shadow, no lift. Locked things do not float.
 *   3. Ledger rules behind the opening, in place of the dot grid every shadcn page ships.
 *      A warden keeps a record; the texture says so.
 *   4. The browser's own surfaces are themed - caret, scrollbar, selection, underline
 *      offset, numerals. These ship with defaults belonging to no design system, and
 *      leaving them is what makes a page feel assembled instead of built.
 *
 * The look is shadcn's; the runtime is not. Kobalte and Tailwind are client-side and these
 * pages ship one hash-pinned script and nothing else (the show-password eye, see peek.ts),
 * so the same visual language is expressed in plain CSS.
 */

import { TOKENS } from "./theme";

export const CSS = `
@font-face {
  font-family: "Geist";
  src: url("/f/geist.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}

/* Palette and ramp live in theme.ts, shared with the MCP App UIs. */
${TOKENS}

*, *::before, *::after { box-sizing: border-box; border-color: var(--border); }

html {
  background: var(--background);
  color-scheme: light dark;
  -webkit-text-size-adjust: 100%;
}

body {
  position: relative;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  font-feature-settings: "rlig" 1, "calt" 1;
  -webkit-font-smoothing: antialiased;
}

/* ---- The browser's own surfaces -----------------------------------------
   Caret, selection, scrollbar, underline offset and numerals all ship with
   defaults that belong to no design system. Theming them is the cheapest
   signal that a page was built rather than assembled. */

::selection { background: var(--foreground); color: var(--background); }

body { caret-color: var(--ring); accent-color: var(--primary); }

* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border);
  border: 3px solid transparent;
  border-radius: 99px;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); background-clip: content-box; }

a { color: var(--primary); text-underline-offset: 0.2em; text-decoration-thickness: 1px; }

/* New York's focus treatment: a soft 3px ring plus a border shift. */
:focus-visible {
  outline: none;
  border-color: var(--ring);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent);
}

/* ---- Shell -------------------------------------------------------------- */

.site-header {
  border-bottom: 1px solid var(--border);
  background: color-mix(in oklch, var(--background) 80%, transparent);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.site-header-inner {
  max-width: 42rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.site-header-inner.is-wide {
  max-width: 68rem;
}

/* Tracked caps, so the wordmark reads as a mark rather than as a line of body copy. */
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.11em;
}

/* Brass appears on the seal and nowhere else. */
.brand svg { color: var(--brass); flex: none; }

.host { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); text-align: right; }
.host b { font-weight: 500; color: var(--foreground); }

.sheet {
  position: relative;
  max-width: 42rem;
  margin: 0 auto;
  padding: clamp(1.75rem, 3.5vw, 2.5rem) 1.5rem 5rem;
}

.sheet.sheet-wide {
  max-width: 68rem;
  padding: clamp(1.25rem, 2.5vw, 2rem) 1.5rem 5rem;
}

/* No background texture. The ledger rules that lived here were removed at the user's
   request (2026-08-17), as was the dot field before them. The identity rests on the seal
   and on material carrying polarity, which do not need a pattern behind them. If texture
   is ever wanted again, it goes on body::before anchored left:0/right:0 - a viewport-width
   offset like -50vw paints past the document and grows a horizontal scrollbar. */

.sheet > * { position: relative; }

/* One authored moment: the sheet settles onto the rules. It starts fully opaque, so a
   blocked or failed animation can never leave the page unreadable. */
@keyframes settle {
  from { transform: translateY(10px); }
  to { transform: translateY(0); }
}
.sheet { animation: settle 620ms cubic-bezier(0.16, 1, 0.3, 1) both; }

h1 {
  margin: 0 0 0.625rem;
  font-size: clamp(1.875rem, 4.8vw, 2.5rem);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

.lede { margin: 0; font-size: 1.0625rem; line-height: 1.6; color: var(--muted-foreground); max-width: 62ch; }

/* ---- Card --------------------------------------------------------------- */

.card {
  margin-top: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-xs);
}

/* Pacing: sign-in sits close to the subject it belongs to, then air, then the two folded
   lists pair tightly with each other. More space above a group than inside it. */
.card[data-open] { margin-top: 2.75rem; }
.card[data-lock] { margin-top: 0.5rem; }

/* Material carries polarity. What the assistant can never do is pressed into the page
   rather than raised off it: muted ground, an inset shadow, no lift. */
.card[data-lock] {
  background: var(--muted);
  box-shadow: var(--shadow-inset);
}
.card[data-lock] .card-header { border-bottom-color: color-mix(in oklch, var(--border) 70%, transparent); }
.card[data-lock] .rows li + li { border-top-color: color-mix(in oklch, var(--border) 70%, transparent); }

.card-header { padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); }

/* ---- Disclosure ---------------------------------------------------------
   Native <details>. No script ships, so the fold is the browser's own; the work
   here is removing the default marker and giving the summary a real hit area. */

details.card { overflow: hidden; }

summary.card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  list-style: none;
  border-bottom: 1px solid transparent;
  transition: background-color 120ms ease, border-color 120ms ease;
}
summary.card-header::-webkit-details-marker { display: none; }
summary.card-header > div { flex: 1; min-width: 0; }
summary.card-header:hover { background: color-mix(in oklch, var(--foreground) 3%, transparent); }

details[open] > summary.card-header { border-bottom-color: var(--border); }

/* The chevron is the only affordance saying this opens, so it earns the motion. */
.chevron {
  flex: none;
  display: flex;
  color: var(--muted-foreground);
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
details[open] > summary .chevron { transform: rotate(180deg); }

/* The whole row is the control; the ring belongs on the row, not the text inside it. */
summary.card-header:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--ring);
}

.card-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.3;
}

.card-desc { margin: 0.3rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }

.card-content { padding: 1.5rem; }

/* The grant subject, shown the way shadcn shows an account row. */
.subject { display: flex; align-items: center; gap: 0.875rem; padding: 1.25rem 1.5rem; }

.avatar {
  flex: none;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-lg);
  background: var(--secondary);
  color: var(--secondary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border: 1px solid var(--border);
}

.subject-name { margin: 0; font-weight: 600; font-size: 1.0625rem; letter-spacing: -0.01em; }
.subject-meta { margin: 0.15rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }

.badge {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

/* ---- Permission rows ---------------------------------------------------- */

.rows { list-style: none; margin: 0; padding: 0; }

.rows li {
  display: grid;
  grid-template-columns: 1.05rem 1fr;
  gap: 0 0.85rem;
  padding: 0.9rem 1.5rem;
}
.rows li + li { border-top: 1px solid var(--border); }

.rows .icon { display: flex; align-items: center; height: 1.5rem; color: var(--muted-foreground); }
.rows .icon[data-tone="yes"] { color: var(--success); }
.rows .icon[data-tone="no"] { color: var(--destructive); }

.rows .row-title { margin: 0; font-size: 0.9375rem; font-weight: 500; }
.rows .row-note { grid-column: 2; margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }

.rows .row-flag {
  grid-column: 2;
  margin: 0.35rem 0 0;
  display: inline-flex;
  justify-self: start;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--muted-foreground);
}

/* ---- Form --------------------------------------------------------------- */

.field { display: grid; gap: 0.5rem; margin-bottom: 1.25rem; }

.field label { font-size: 0.9375rem; font-weight: 500; line-height: 1; }
.field .hint { font-size: 0.875rem; color: var(--muted-foreground); line-height: 1.4; }

.field input {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--foreground);
  font-family: inherit;
  font-size: 0.9375rem;
  box-shadow: var(--shadow-xs);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.field input::placeholder { color: var(--muted-foreground); }

.field-control { position: relative; display: grid; gap: 0.4rem; }

/* ---- Validation ---------------------------------------------------------
   The browser's own, styled. :user-invalid and not :invalid: the latter marks an
   untouched empty required field as wrong the moment the page paints, which would greet a
   first-time visitor to a consent screen with two red boxes. */

.field input:user-invalid {
  border-color: var(--destructive);
  box-shadow: var(--shadow-xs);
}
.field input:user-invalid:focus-visible {
  border-color: var(--destructive);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--destructive) 40%, transparent);
}

/* The message is always laid out and only toggles visibility. Switching display none/flex
   reflows everything below it: the submit button dropped 50px the moment an error
   appeared, which is exactly when the pointer is on its way to that button. Reserving the
   line costs one line per field and holds the layout completely still - and it holds it
   however the message wraps, which a fixed min-height would not. */
.error {
  display: flex;
  visibility: hidden;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--destructive);
}
.error svg { flex: none; margin-top: 0.12rem; width: 14px; height: 14px; }
input:user-invalid ~ .error { visibility: visible; }

/* ---- Password peek ------------------------------------------------------
   Ships hidden and is revealed by peek.ts, so a blocked script leaves no dead control. */

.peek {
  position: absolute;
  top: 0;
  right: 0;
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: color 120ms ease;
}
.peek[hidden] { display: none; }
.peek:hover { color: var(--foreground); }
.peek-off { display: none; }
.peek[aria-pressed="true"] .peek-on { display: none; }
.peek[aria-pressed="true"] .peek-off { display: flex; }
/* A class rather than :has(). The selector was correct but :has() carries style-invalidation
   cost on every DOM mutation, and the markup already knows whether the eye is there. */
.field-control-peek input { padding-right: 2.5rem; }

/* ---- Button -------------------------------------------------------------- */

button[type="submit"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  height: 2.25rem;
  padding: 0 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--primary-foreground);
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  transition: opacity 120ms ease;
}

button[type="submit"]:hover { opacity: 0.9; }
button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }

.footnote {
  margin: 1.75rem 0 0;
  font-size: 0.875rem;
  line-height: 1.65;
  color: var(--muted-foreground);
  max-width: 66ch;
}
.footnote strong { font-weight: 500; color: var(--foreground); }

/* ---- Alert -------------------------------------------------------------- */

.alert {
  margin-top: 1.5rem;
  display: grid;
  grid-template-columns: 1rem 1fr;
  gap: 0.25rem 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  box-shadow: var(--shadow-xs);
}
.alert .icon { display: flex; align-items: center; height: 1.25rem; color: var(--muted-foreground); }
.alert[data-tone="no"] .icon { color: var(--destructive); }
.alert[data-tone="yes"] .icon { color: var(--success); }
.alert p { margin: 0; font-size: 0.9375rem; }
.alert p + p { grid-column: 2; margin-top: 0.35rem; color: var(--muted-foreground); }

/* ---- The quoted letter, on the send-approval page ------------------------ */

.letter-meta { display: grid; grid-template-columns: 5rem 1fr; gap: 0.5rem 1rem; padding: 1rem 1.5rem; }
.letter-meta + .letter-meta { border-top: 1px solid var(--border); }
.letter-key { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); }
.letter-val { margin: 0; font-size: 0.9375rem; overflow-wrap: anywhere; }

.letter-body {
  padding: 1.5rem;
  border-top: 1px solid var(--border);
  background: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 26rem;
  overflow-y: auto;
  font-size: 0.875rem;
  line-height: 1.65;
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
}

.record { margin: 0; }
.record div { display: grid; grid-template-columns: 9rem 1fr; gap: 0.5rem 1rem; padding: 0.875rem 1.5rem; }
.record div + div { border-top: 1px solid var(--border); }
.record dt { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); }
.record dd { margin: 0; font-size: 0.9375rem; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

code {
  font-family: var(--font-mono);
  font-size: 0.8125em;
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--muted);
  overflow-wrap: anywhere;
}

/* A hash is measurement, so it gets the monospace and the tabular figures - grouped into
   readable runs instead of sixty-four characters wrapping through a paragraph. */
.fingerprint {
  display: block;
  margin: 0.55rem 0 0;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--muted);
  box-shadow: var(--shadow-inset);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.7;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}

/* ---- Portal & Dashboard Components ------------------------------------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.5rem 0.875rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 100ms ease;
  white-space: nowrap;
  user-select: none;
}
.btn:active { transform: scale(0.98); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
  box-shadow: var(--shadow-xs);
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.92;
}

.btn-secondary {
  background: var(--secondary);
  color: var(--secondary-foreground);
  border-color: var(--border);
}
.btn-secondary:hover:not(:disabled) {
  background: color-mix(in oklch, var(--foreground) 8%, var(--secondary));
  border-color: color-mix(in oklch, var(--foreground) 18%, var(--border));
}

.btn-outline {
  background: transparent;
  color: var(--foreground);
  border-color: var(--border);
}
.btn-outline:hover:not(:disabled) {
  background: var(--muted);
  border-color: color-mix(in oklch, var(--foreground) 20%, var(--border));
}

.btn-destructive {
  background: color-mix(in oklch, var(--destructive) 12%, transparent);
  color: var(--destructive);
  border-color: color-mix(in oklch, var(--destructive) 24%, transparent);
}
.btn-destructive:hover:not(:disabled) {
  background: color-mix(in oklch, var(--destructive) 20%, transparent);
  border-color: color-mix(in oklch, var(--destructive) 40%, transparent);
}

.btn-sm {
  font-size: 0.75rem;
  padding: 0.35rem 0.65rem;
  border-radius: var(--radius-sm);
  height: 1.85rem;
}

.btn-lg {
  font-size: 0.875rem;
  padding: 0.65rem 1.15rem;
  height: 2.5rem;
}

.badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  border: 1px solid var(--border);
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.status-dot.is-live {
  animation: pulse-status 2.4s ease-in-out infinite;
}

@keyframes pulse-status {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.85); }
}

/* Modal Dialog System */
html.modal-open,
body.modal-open {
  overflow: hidden !important;
  touch-action: none;
}

.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem;
  overflow-y: auto;
  box-sizing: border-box;
  animation: modal-fade-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@media (prefers-color-scheme: dark) {
  .modal-backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
}

@keyframes modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-box {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 30rem;
  max-height: calc(100dvh - 3rem);
  padding: 1.5rem;
  margin: auto;
  overflow-y: auto;
  box-sizing: border-box;
  box-shadow: 0 20px 35px -8px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border);
  animation: modal-zoom-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes modal-zoom-in {
  from { opacity: 0; transform: scale(0.97) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Provider Connection Buttons */
.provider-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.95rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  transition: all 140ms ease;
}
.provider-btn:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--foreground) 24%, var(--border));
  background: var(--secondary);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px -2px rgba(0, 0, 0, 0.1);
}
.provider-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

/* Monospace Code Input Box with Copy */
.code-input-group {
  display: flex;
  align-items: center;
  position: relative;
  background: var(--input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.code-input-group:focus-within {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 35%, transparent);
}
.code-input-group input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--foreground);
  padding: 0.55rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  outline: none;
  box-shadow: none;
}

@media (max-width: 30rem) {
  .letter-meta, .record div { grid-template-columns: 1fr; gap: 0.15rem; }
  .host { font-size: 0.6875rem; }
  .brand { letter-spacing: 0.08em; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();
