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

:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --success: oklch(0.596 0.145 163.225);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);

  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --success: oklch(0.696 0.17 162.48);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
  }
}

*, *::before, *::after { box-sizing: border-box; border-color: var(--border); }

html {
  background: var(--background);
  color-scheme: light dark;
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  line-height: 1.5715;
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
  font-size: 0.875rem;
  letter-spacing: -0.01em;
  margin: 0;
}

.host { margin: 0; font-size: 0.75rem; color: var(--muted-foreground); text-align: right; }
.host b { font-weight: 500; color: var(--foreground); }

.sheet {
  max-width: 42rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 3.5rem) 1.5rem 5rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.5rem, 4vw, 1.875rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

.lede { margin: 0; color: var(--muted-foreground); max-width: 60ch; }

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
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.card-desc { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--muted-foreground); }

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

.subject-name { margin: 0; font-weight: 600; font-size: 0.9375rem; letter-spacing: -0.01em; }
.subject-meta { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--muted-foreground); }

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
  grid-template-columns: 1rem 1fr;
  gap: 0 0.75rem;
  padding: 0.75rem 1.5rem;
}
.rows li + li { border-top: 1px solid var(--border); }

.rows .icon { display: flex; align-items: center; height: 1.3rem; color: var(--muted-foreground); }
.rows .icon[data-tone="yes"] { color: var(--success); }
.rows .icon[data-tone="no"] { color: var(--destructive); }

.rows .row-title { margin: 0; font-size: 0.875rem; font-weight: 500; }
.rows .row-note { grid-column: 2; margin: 0.2rem 0 0; font-size: 0.8125rem; color: var(--muted-foreground); }

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

.field label { font-size: 0.875rem; font-weight: 500; line-height: 1; }
.field .hint { font-size: 0.8125rem; color: var(--muted-foreground); line-height: 1.4; }

.field input {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--foreground);
  font-family: inherit;
  font-size: 0.875rem;
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
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  transition: opacity 120ms ease;
}

button[type="submit"]:hover { opacity: 0.9; }
button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }

.footnote {
  margin: 1.5rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.6;
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
.alert p { margin: 0; font-size: 0.875rem; }
.alert p + p { grid-column: 2; margin-top: 0.35rem; color: var(--muted-foreground); }

/* ---- The quoted letter, on the send-approval page ------------------------ */

.letter-meta { display: grid; grid-template-columns: 5rem 1fr; gap: 0.5rem 1rem; padding: 1rem 1.5rem; }
.letter-meta + .letter-meta { border-top: 1px solid var(--border); }
.letter-key { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); }
.letter-val { margin: 0; font-size: 0.875rem; overflow-wrap: anywhere; }

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
.record dd { margin: 0; font-size: 0.875rem; overflow-wrap: anywhere; }

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
