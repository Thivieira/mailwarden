import { CSS } from "./tokens";

/**
 * Wraps SSR-rendered body markup in the full document. Written as a string function
 * rather than a component so the emitted bytes are exact: doctype, inlined critical CSS,
 * and the direction contract as a real HTML comment that survives the build.
 */

const CONTRACT = `<!--
THESIS: Authorization in the notation this audience already uses to ask "is this really
the thing?" - the key fingerprint. Refuses the centered card on gray.
OWN-WORLD: Graphite ground, bone ink, one mint reserved for granted state, one amber-red
for denied. Monospace only where bytes are checkable. Ruled blocks and hairlines; no
cards, no glow, no radius above 2px.
STORY: The visitor sees a checkable fingerprint of the exact request, understands which
powers they are granting, and enters their vault secret.
FIRST VIEWPORT: Origin strip naming the host. The randomart field beside the request
digest at full scale. The scope manifest as a ruled table with struck state marks. Entry
fields and the struck submit sit bottom-left.
FORM: The Fingerprint Block; candidate 1 of the grounded list, chosen over the roll's
assignment. Seed bb68fd9a.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

/**
 * The bishop's walk, as a mark. Inlined so the tab carries the design without a request
 * and without loosening the CSP to a remote origin.
 */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230E1110'/%3E%3Cg fill='%235BE0A8'%3E%3Crect x='2' y='10' width='2' height='2'/%3E%3Crect x='4' y='8' width='2' height='2'/%3E%3Crect x='6' y='6' width='2' height='2'/%3E%3Crect x='8' y='8' width='2' height='2'/%3E%3Crect x='10' y='6' width='2' height='2'/%3E%3Crect x='12' y='4' width='2' height='2'/%3E%3C/g%3E%3C/svg%3E";

export function document_(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark"><link rel="icon" href="${FAVICON}"><title>${title}</title><style>${CSS}</style></head><body>${CONTRACT}${body}</body></html>`;
}
