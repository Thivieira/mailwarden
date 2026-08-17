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
 * pages ship zero JavaScript, so the same visual language is expressed in plain CSS.
 */

export const CSS = `
@font-face {
  font-family: "Geist";
  src: url("/f/geist.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}

/**
 * shadcn's structure with Mailwarden's palette, which is what its theming layer is for.
 * The neutral ramp is warmed toward the old paper stock instead of running pure gray, the
 * primary is the navy, and brass survives as the single brand accent.
 *
 * Hues are held constant per family so the ramp stays coherent:
 * navy 245, paper 85, brass 82, green 160, red 27.
 */
:root {
  --radius: 0.625rem;

  --background: oklch(0.988 0.004 85);
  --foreground: oklch(0.21 0.018 245);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.018 245);
  --primary: oklch(0.34 0.062 245);
  --primary-foreground: oklch(0.985 0.004 85);
  --secondary: oklch(0.962 0.006 85);
  --secondary-foreground: oklch(0.28 0.03 245);
  --muted: oklch(0.966 0.005 85);
  --muted-foreground: oklch(0.505 0.018 245);
  --destructive: oklch(0.505 0.15 27);
  --success: oklch(0.5 0.095 160);
  --brass: oklch(0.56 0.09 82);
  --border: oklch(0.905 0.007 85);
  --input: oklch(0.905 0.007 85);
  --ring: oklch(0.55 0.075 245);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-xs: 0 1px 2px 0 oklch(0.21 0.018 245 / 0.06);
  /* The pressed state. Locked things sit below the page, not above it. */
  --shadow-inset: inset 0 1px 2px 0 oklch(0.21 0.018 245 / 0.05);

  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* The ground carries the navy hue rather than going neutral black, and the primary
       lifts to a legible blue instead of inverting to white. */
    --background: oklch(0.17 0.016 245);
    --foreground: oklch(0.97 0.005 85);
    --card: oklch(0.215 0.019 245);
    --card-foreground: oklch(0.97 0.005 85);
    --primary: oklch(0.7 0.105 245);
    --primary-foreground: oklch(0.17 0.03 245);
    --secondary: oklch(0.275 0.021 245);
    --secondary-foreground: oklch(0.97 0.005 85);
    --muted: oklch(0.265 0.02 245);
    --muted-foreground: oklch(0.72 0.02 245);
    --destructive: oklch(0.68 0.16 27);
    --success: oklch(0.72 0.13 160);
    --brass: oklch(0.75 0.1 82);
    --border: oklch(1 0 0 / 12%);
    --input: oklch(1 0 0 / 16%);
    --ring: oklch(0.62 0.09 245);

    --shadow-xs: 0 1px 2px 0 oklch(0 0 0 / 0.3);
    --shadow-inset: inset 0 1px 3px 0 oklch(0 0 0 / 0.35);
  }
}

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

/* Ledger rules rather than the dot field every shadcn page ships. A warden keeps a
   record. Anchored to the body edges: a viewport-width offset like -50vw paints past the
   document and grows a horizontal scrollbar. */
body::before {
  content: "";
  position: absolute;
  top: 3.5rem;
  left: 0;
  right: 0;
  height: 24rem;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    to bottom,
    var(--border) 0 1px,
    transparent 1px 28px
  );
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.55), transparent 78%);
  -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.55), transparent 78%);
}

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

.error {
  display: none;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--destructive);
}
.error svg { flex: none; margin-top: 0.12rem; width: 14px; height: 14px; }
input:user-invalid ~ .error { display: flex; }

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

@media (max-width: 30rem) {
  .letter-meta, .record div { grid-template-columns: 1fr; gap: 0.15rem; }
  .host { font-size: 0.6875rem; }
  .brand { letter-spacing: 0.08em; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();
