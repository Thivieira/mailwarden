import { TOKENS, SEAL_PATHS } from "../../ui/theme";

/**
 * The HTML shell every MCP App is served in.
 *
 * MCP Apps render in a host-controlled sandboxed iframe with a deny-by-default CSP, so
 * everything ships inline: no external stylesheet, no CDN, no font URL. The app's JS is
 * bundled in by `build.ts`. That is the opposite constraint from the browser pages, which
 * forbid script almost entirely — here script IS the app, and the isolation comes from the
 * host's sandbox rather than from our own CSP.
 *
 * The palette comes from `theme.ts`, the same tokens the browser pages use, so a settings
 * panel inside a conversation and the consent screen in a tab are visibly one product.
 * There is no `@font-face` — Geist is not fetchable from inside the sandbox without opening
 * a CSP hole, and the fallback stack is close enough that it is not worth one.
 */
const BASE_CSS = `
${TOKENS}

*, *::before, *::after { box-sizing: border-box; }

html { color-scheme: light dark; }

body {
  margin: 0;
  padding: 1rem;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--foreground); color: var(--background); }
* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

:focus-visible {
  outline: none;
  border-color: var(--ring);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent);
}

.app { display: flex; flex-direction: column; gap: 1rem; max-width: 40rem; margin: 0 auto; }

.app-head { display: flex; align-items: center; gap: 0.6rem; }
.app-head svg { color: var(--brass); flex: none; }
.app-head h1 {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.11em;
}
.app-head .spacer { flex: 1; }

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.card[data-lock] { background: var(--muted); box-shadow: var(--shadow-inset); }

.card-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
.card-title { margin: 0; font-size: 1.0625rem; font-weight: 600; letter-spacing: -0.015em; }
.card-desc { margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }

.rows { list-style: none; margin: 0; padding: 0; }
.rows li { display: grid; grid-template-columns: 1.05rem 1fr auto; gap: 0 0.8rem; padding: 0.8rem 1.25rem; align-items: start; }
.rows li + li { border-top: 1px solid var(--border); }
.rows .icon { display: flex; align-items: center; height: 1.5rem; color: var(--muted-foreground); }
.rows .row-title { margin: 0; font-size: 0.9375rem; font-weight: 500; }
.rows .row-note { grid-column: 2; margin: 0.2rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.12rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}
.badge[data-tone="warn"] { color: var(--brass); border-color: color-mix(in oklch, var(--brass) 40%, transparent); background: color-mix(in oklch, var(--brass) 12%, transparent); }
.badge[data-tone="live"] { color: var(--success); border-color: color-mix(in oklch, var(--success) 40%, transparent); background: color-mix(in oklch, var(--success) 12%, transparent); }

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  height: 2.25rem;
  padding: 0 0.9rem;
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
button:hover { opacity: 0.9; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button[data-variant="quiet"] {
  background: transparent;
  color: var(--foreground);
  border-color: var(--border);
  box-shadow: none;
  height: 2rem;
  font-size: 0.875rem;
}
button[data-variant="quiet"]:hover { background: var(--secondary); opacity: 1; }
button[data-variant="danger"] { background: transparent; color: var(--destructive); border-color: color-mix(in oklch, var(--destructive) 40%, transparent); box-shadow: none; height: 2rem; font-size: 0.875rem; }

.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 1rem 1.25rem; }

.empty { padding: 2rem 1.25rem; text-align: center; color: var(--muted-foreground); font-size: 0.9375rem; }

.notice {
  display: grid;
  grid-template-columns: 1rem 1fr;
  gap: 0.7rem;
  padding: 0.8rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  font-size: 0.875rem;
}
.notice svg { color: var(--muted-foreground); margin-top: 0.15rem; }
.notice[data-tone="bad"] { border-color: color-mix(in oklch, var(--destructive) 40%, transparent); }
.notice[data-tone="bad"] svg { color: var(--destructive); }

.skeleton { height: 0.9rem; border-radius: 4px; background: var(--muted); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`.trim();

/**
 * Wraps a bundled app script in its document. `script` is the output of `Bun.build` over
 * the app's own `.client.ts` — never request data, so nothing here is interpolated from
 * anything a user or an email can influence.
 */
export function appShell(title: string, script: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${BASE_CSS}</style></head><body><div class="app" id="root"><div class="card"><div class="card-header"><div class="skeleton" style="width:9rem"></div></div><div class="empty">Loading…</div></div></div><script type="module">${script}</script></body></html>`;
}

/** The seal, for app headers. Same geometry as the browser pages. */
export const SEAL_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SEAL_PATHS}</svg>`;
