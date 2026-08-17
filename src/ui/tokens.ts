/**
 * shadcn/ui — New York. Mailwarden's visual world.
 *
 * The token values are shadcn's own neutral palette verbatim (oklch, light and dark), so
 * this reads as the same system a Next.js app built on shadcn would ship. Cards carry the
 * structure, Geist is the face, controls are h-9, and the focus treatment is New York's
 * signature 3px ring.
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

  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
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

::selection { background: var(--foreground); color: var(--background); }

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

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.9375rem;
  letter-spacing: -0.01em;
  margin: 0;
}

/* Brass appears here and nowhere else, the same rule the previous world held. */
.brand svg { color: var(--brass); }

.host { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); text-align: right; }
.host b { font-weight: 500; color: var(--foreground); }

/* A dot field behind the opening, faded out before it reaches the content. Texture the
   world already uses; it carries no meaning, so it never sits behind anything to read. */
.sheet {
  position: relative;
  max-width: 42rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 3.5rem) 1.5rem 5rem;
}

/* Anchored to the body edges rather than a viewport-width offset: a -50vw inset paints
   past the document and the page grows a horizontal scrollbar. */
body::before {
  content: "";
  position: absolute;
  top: 3.5rem;
  left: 0;
  right: 0;
  height: 22rem;
  pointer-events: none;
  background-image: radial-gradient(circle at center, var(--border) 1.1px, transparent 1.1px);
  background-size: 18px 18px;
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.7), transparent 80%);
  -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.7), transparent 80%);
}

.sheet > * { position: relative; }

h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.75rem, 4.4vw, 2.25rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

.lede { margin: 0; font-size: 1.0625rem; line-height: 1.6; color: var(--muted-foreground); max-width: 58ch; }

/* ---- Card --------------------------------------------------------------- */

.card {
  margin-top: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-xs);
}

.card-header { padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); }

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
  background: var(--muted);
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
  margin: 1.5rem 0 0;
  font-size: 0.875rem;
  line-height: 1.65;
  color: var(--muted-foreground);
  max-width: 62ch;
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
.record dd { margin: 0; font-size: 0.9375rem; overflow-wrap: anywhere; }

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125em;
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--muted);
  overflow-wrap: anywhere;
}

@media (max-width: 30rem) {
  .letter-meta, .record div { grid-template-columns: 1fr; gap: 0.15rem; }
  .host { font-size: 0.6875rem; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();
