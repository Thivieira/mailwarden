/**
 * The Hotel Key Card — Mailwarden's visual world.
 *
 * The page is the printed sleeve a front desk hands you: it says which doors the key
 * opens, which it does not, where the desk is, and that you can hand it back any time.
 *
 * Light is chosen from the use scene, not the category. PRODUCT.md's reader is a
 * non-technical person who clicked "connect" in a chat app and is quietly asking whether
 * they are giving a robot their inbox. That person is at a desk in daylight wanting
 * reassurance, and a printed paper document reads calmer than a terminal.
 *
 * Shipped as an inlined <style> block; only the display face is a second request, served
 * same-origin from /f/ and cached forever.
 */

export const CSS = `
@font-face {
  font-family: "Archivo";
  src: url("/f/a400.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Archivo";
  src: url("/f/a600.woff2") format("woff2");
  font-weight: 600;
  font-display: swap;
}

:root {
  /* Printed stock and ink */
  --stock: #EFEDE8;
  --stock-deep: #E3E0D8;
  --card: #FFFFFF;
  --ink: #14384F;
  --ink-soft: #5A6E7E;
  --rule: #C9C6BD;

  /* The one warm metal: foil on the card, and nothing else. */
  --brass: #9A7628;

  /* Doors */
  --opens: #2E6B4F;
  --shut: #A3402F;

  --measure: 62ch;

  --display: "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  color-scheme: light;
  accent-color: var(--ink);
}

*, *::before, *::after { box-sizing: border-box; }

html {
  background: var(--stock);
  scrollbar-color: var(--rule) var(--stock);
  scrollbar-width: thin;
}

body {
  margin: 0;
  background: var(--stock);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 17px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}

::selection { background: var(--ink); color: var(--stock); }

:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }

/* ---- The sleeve --------------------------------------------------------- */

/* The printed band across the top of the sleeve. A committed field at page scale, not a
   header bar: it owns its region and the name reverses out of it. */
.band {
  background: var(--ink);
  color: var(--stock);
  padding: clamp(1rem, 3vw, 1.5rem) clamp(1.25rem, 5vw, 3rem);
}

.band-inner {
  max-width: 54rem;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 2rem;
  align-items: baseline;
  justify-content: space-between;
}

.wordmark {
  font-family: var(--display);
  font-weight: 600;
  font-size: clamp(1.05rem, 2.4vw, 1.3rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin: 0;
}

/* Where the desk is. This is the anti-forgery line, so it is printed, not whispered. */
.desk { margin: 0; font-size: 0.9rem; opacity: 0.92; }
.desk b { font-weight: 600; }

.sheet {
  max-width: 54rem;
  margin: 0 auto;
  padding: clamp(2rem, 5vw, 3.5rem) clamp(1.25rem, 5vw, 3rem) clamp(3rem, 6vw, 5rem);
}

h1 {
  font-family: var(--display);
  font-weight: 600;
  font-size: clamp(1.7rem, 4.4vw, 2.6rem);
  line-height: 1.12;
  letter-spacing: -0.015em;
  margin: 0 0 0.75rem;
  text-wrap: balance;
}

.lede { margin: 0 0 2.5rem; max-width: var(--measure); color: var(--ink-soft); }

/* ---- The key card ------------------------------------------------------- */

/* A card in the hand: landscape proportion, a punched slot at one end, and the magnetic
   stripe along the bottom. Those three details are what separate a key card from a box. */
.keycard {
  position: relative;
  background: var(--card);
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: clamp(1.4rem, 3vw, 1.9rem);
  padding-bottom: clamp(2.6rem, 5vw, 3.2rem);
  box-shadow: 0 1px 2px rgba(20, 56, 79, 0.07), 0 14px 28px -18px rgba(20, 56, 79, 0.4);
  width: min(100%, 26rem);
  overflow: hidden;
}

/* The punched slot, top right, the way it sits on a real card. */
.keycard::before {
  content: "";
  position: absolute;
  top: clamp(1.4rem, 3vw, 1.9rem);
  right: clamp(1.4rem, 3vw, 1.9rem);
  width: 2.6rem;
  height: 8px;
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: var(--stock);
}

/* The stripe. The only place brass appears on the whole page. */
.keycard::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: clamp(0.9rem, 2vw, 1.15rem);
  height: 0.7rem;
  background: var(--brass);
  opacity: 0.9;
}

.keycard .for { font-size: 0.76rem; letter-spacing: 0.13em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
.keycard .holder { font-family: var(--display); font-weight: 600; font-size: clamp(1.45rem, 3.2vw, 1.9rem); line-height: 1.1; margin: 0.2rem 0 0; }
.keycard .until { margin: 0.55rem 0 0; font-size: 0.88rem; color: var(--ink-soft); }

/* ---- Doors -------------------------------------------------------------- */

.doors { margin: 2.75rem 0 0; }

.doors h2 {
  font-family: var(--display);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  margin: 0 0 0.85rem;
}

.doors ul { list-style: none; margin: 0; padding: 0; }

.doors li {
  padding: 0.85rem 0;
  border-top: 1px solid var(--rule);
  display: grid;
  grid-template-columns: 1.5rem 1fr;
  gap: 0 0.85rem;
}
.doors li:last-child { border-bottom: 1px solid var(--rule); }

/* The mark reads without colour: a drawn key or a struck-through key, never hue alone. */
.doors .m { font-weight: 600; line-height: 1.5; }
.doors .m[data-d="opens"] { color: var(--opens); }
.doors .m[data-d="shut"] { color: var(--shut); }
.doors .m[data-d="off"] { color: var(--ink-soft); }

.doors .what { margin: 0; }
.doors .note { grid-column: 2; margin: 0.2rem 0 0; font-size: 0.9rem; color: var(--ink-soft); }

.doors .off-note {
  grid-column: 2;
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-soft);
}

.doors--shut { margin-top: 2.5rem; }
.doors--shut li { border-color: var(--rule); }

/* ---- Sign in ------------------------------------------------------------ */

/* The rule spans the sheet; only the fields inside it are held to a comfortable width. */
.signin {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 2px solid var(--ink);
}

.signin > * { max-width: 27rem; }

.field { display: grid; gap: 0.35rem; margin-bottom: 1.25rem; }

.field label { font-weight: 600; font-size: 0.92rem; }
.field .hint { font-size: 0.85rem; color: var(--ink-soft); }

.field input {
  width: 100%;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--ink-soft);
  border-radius: 4px;
  background: var(--card);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 1rem;
}

.field input::placeholder { color: #8D9AA5; }
.field input:hover { border-color: var(--ink); }
.field input:focus-visible { border-color: var(--ink); outline-offset: 1px; }

button[type="submit"] {
  padding: 0.85rem 1.6rem;
  border: 1px solid var(--ink);
  border-radius: 4px;
  background: var(--ink);
  color: var(--stock);
  font-family: var(--display);
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

button[type="submit"]:hover { background: transparent; color: var(--ink); }
button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }

.handback { margin: 1.5rem 0 0; max-width: var(--measure); font-size: 0.92rem; color: var(--ink-soft); }

/* ---- The letter, on the send-approval page ------------------------------ */

/* Everything inside is untrusted content, so it is visibly set apart as a quoted
   document rather than blended into the page's own voice. */
.letter {
  margin: 2rem 0 0;
  background: var(--card);
  border: 1px solid var(--rule);
  border-radius: 6px;
  overflow: hidden;
}

.letter-row {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 0.25rem 1rem;
  padding: 0.85rem clamp(1rem, 3vw, 1.5rem);
  border-bottom: 1px solid var(--rule);
}

.letter-label { margin: 0; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); }
.letter-value { margin: 0; overflow-wrap: anywhere; }

.letter-body {
  padding: clamp(1rem, 3vw, 1.5rem);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 26rem;
  overflow-y: auto;
  line-height: 1.65;
}

.confirm-note { margin: 0 0 1.25rem; color: var(--ink-soft); font-size: 0.92rem; }

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  overflow-wrap: anywhere;
}

@media (max-width: 34rem) {
  .letter-row { grid-template-columns: 1fr; }
}

/* ---- Outcomes ----------------------------------------------------------- */

.outcome {
  margin: 0 0 2rem;
  padding: 1.25rem 1.5rem;
  border-radius: 6px;
  background: var(--stock-deep);
  max-width: var(--measure);
}
.outcome p { margin: 0 0 0.6rem; }
.outcome p:last-child { margin-bottom: 0; }

.record { margin: 2rem 0 0; border-top: 1px solid var(--rule); }
.record div { display: grid; grid-template-columns: 10rem 1fr; gap: 0.5rem 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--rule); }
.record dt { font-weight: 600; font-size: 0.92rem; margin: 0; }
.record dd { margin: 0; color: var(--ink-soft); overflow-wrap: anywhere; }

@media (max-width: 34rem) {
  .record div { grid-template-columns: 1fr; gap: 0.15rem; }
  .keycard { padding-left: 2.75rem; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();
