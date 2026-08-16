/**
 * The Fingerprint Block — Mailwarden's visual world.
 *
 * Shipped as an inlined <style> block rather than a linked stylesheet: these pages are
 * 20-40 second interstitials on a locked-down CSP, and one request that carries its own
 * styles beats two requests every time.
 *
 * Dark is chosen from the use scene, not the category: this is a technical operator
 * mid-flow in an AI client, verifying a key fingerprint. Fingerprint verification lives
 * in a terminal, and the world follows it there.
 */

export const CSS = `
:root {
  /* Ground and structure */
  --ground: #0E1110;
  --raised: #151917;
  --rule: #2A302D;
  --rule-strong: #3D453F;

  /* Ink */
  --ink: #E4E8E3;
  --ink-muted: #8A938C;

  /* State. These never appear on chrome - only on marks that carry meaning. */
  --granted: #5BE0A8;
  --denied: #FF6B4A;
  --held: #E8C46A;

  --measure: 68ch;
  --gap: 1.5rem;

  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  color-scheme: dark;
  accent-color: var(--granted);
}

*, *::before, *::after { box-sizing: border-box; }

html {
  background: var(--ground);
  /* Themed browser surfaces: these ship as defaults belonging to no design system. */
  scrollbar-color: var(--rule-strong) var(--ground);
  scrollbar-width: thin;
}

body {
  margin: 0;
  padding: clamp(1.25rem, 4vw, 3rem) clamp(1.25rem, 5vw, 4rem);
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.55;
  font-variant-numeric: tabular-nums;
  -webkit-text-size-adjust: 100%;
}

::selection { background: var(--granted); color: var(--ground); }

:focus-visible {
  outline: 2px solid var(--granted);
  outline-offset: 2px;
}

/* ---- Structure -------------------------------------------------------- */

.sheet {
  max-width: 62rem;
  margin: 0 auto;
}

/* The origin strip. The first thing on the page is where the page actually is. */
.origin {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.origin b {
  color: var(--ink);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}

h1 {
  margin: 2.5rem 0 0.5rem;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
  text-wrap: balance;
}

.lede {
  margin: 0 0 2.5rem;
  max-width: var(--measure);
  color: var(--ink-muted);
}

/* ---- The fingerprint block -------------------------------------------- */

.block {
  border: 1px solid var(--rule);
  background: var(--raised);
}

.block > figcaption,
.block-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  align-items: baseline;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.art {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: clamp(1rem, 3vw, 2rem);
  align-items: center;
  padding: clamp(1rem, 3vw, 1.75rem);
}

.art pre {
  margin: 0;
  font-family: var(--mono);
  font-size: clamp(0.7rem, 2.1vw, 0.95rem);
  line-height: 1.25;
  letter-spacing: 0.08em;
  color: var(--ink);
  white-space: pre;
  overflow-x: auto;
}

.art dl { margin: 0; display: grid; gap: 0.85rem; }
.art dt {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.art dd {
  margin: 0.15rem 0 0;
  font-family: var(--mono);
  font-size: 0.85rem;
  /* Break long URLs only where they must, not mid-word by default. */
  overflow-wrap: anywhere;
}

/* ---- The scope manifest ------------------------------------------------ */

.manifest { width: 100%; border-collapse: collapse; font-size: 0.9rem; }

.manifest caption {
  padding: 0.6rem 1rem;
  border: 1px solid var(--rule);
  border-bottom: 0;
  background: var(--raised);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  text-align: left;
}

.manifest th, .manifest td {
  padding: 0.55rem 1rem;
  border: 1px solid var(--rule);
  text-align: left;
  vertical-align: baseline;
}

.manifest th {
  width: 1%;
  white-space: nowrap;
  font-family: var(--mono);
  font-weight: 500;
  font-size: 0.85rem;
}

.manifest td { color: var(--ink-muted); }

/* State is a struck mark, never a hue alone: the mark reads without color. */
.mark {
  font-family: var(--mono);
  font-size: 0.85rem;
  white-space: nowrap;
}
.mark[data-state="granted"] { color: var(--granted); }
.mark[data-state="denied"]  { color: var(--denied); }
.mark[data-state="held"]    { color: var(--held); }

/* ---- Credential entry --------------------------------------------------- */

.entry { margin-top: 2rem; display: grid; gap: 1.25rem; max-width: 34rem; }

.field { display: grid; gap: 0.4rem; }

.field label {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.field input {
  width: 100%;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--rule-strong);
  border-radius: 2px;
  background: var(--raised);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 0.95rem;
  caret-color: var(--granted);
}

.field input::placeholder { color: #6E7671; }
.field input:hover { border-color: #4C554F; }
.field input:focus-visible { border-color: var(--granted); outline-offset: 1px; }

button[type="submit"] {
  justify-self: start;
  padding: 0.7rem 1.4rem;
  border: 1px solid var(--granted);
  border-radius: 2px;
  background: var(--granted);
  color: var(--ground);
  font-family: var(--mono);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 160ms cubic-bezier(0.16, 1, 0.3, 1), color 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

button[type="submit"]:hover { background: transparent; color: var(--granted); }
button[type="submit"]:disabled { opacity: 0.45; cursor: not-allowed; background: transparent; color: var(--ink-muted); border-color: var(--rule-strong); }

/* ---- Outcome ------------------------------------------------------------ */

.outcome { margin: 2.5rem 0 0; padding-left: 1rem; border-left: 1px solid var(--rule-strong); }
.outcome[data-state="granted"] { border-left-color: var(--granted); }
.outcome[data-state="denied"]  { border-left-color: var(--denied); }
.outcome p { margin: 0 0 0.6rem; max-width: var(--measure); }
.outcome p:last-child { margin-bottom: 0; }

.note {
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
  max-width: var(--measure);
  font-size: 0.85rem;
  color: var(--ink-muted);
}

/* Below this the three-column manifest squeezes to one word per line, so each row
   becomes its own stacked record instead. */
@media (max-width: 46rem) {
  /* caption must join these: left as table-caption inside a block it shrink-wraps. */
  .manifest, .manifest caption, .manifest tbody, .manifest tr, .manifest th, .manifest td { display: block; }

  .manifest tr {
    border: 1px solid var(--rule);
    border-top: 0;
    padding: 0.75rem 1rem;
  }

  .manifest th, .manifest td {
    width: auto;
    padding: 0;
    border: 0;
    white-space: normal;
  }

  .manifest td { margin-top: 0.3rem; }

  .manifest .mark {
    margin-top: 0.5rem;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }
}

@media (max-width: 34rem) {
  .art { grid-template-columns: 1fr; }
  .art pre { font-size: 0.78rem; letter-spacing: 0.04em; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();
