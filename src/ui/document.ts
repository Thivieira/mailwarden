import { CSS } from "./tokens";

/**
 * Wraps SSR-rendered body markup in the full document. Written as a string function
 * rather than a component so the emitted bytes are exact: doctype, inlined critical CSS,
 * the font preload, and the direction contract as a real HTML comment that survives the
 * build.
 */

const CONTRACT = `<!--
THESIS: The page is the printed sleeve a front desk hands you with a key - which doors it
opens, which it never opens, where the desk is. Refuses the centered consent card with
its Allow and Deny buttons.
OWN-WORLD: Printed paper stock, deep navy ink, one brass foil edge on the card itself.
Archivo for display, system sans for reading, drawn keys struck through for what is
refused. No dark ground, no monospace, no jargon.
STORY: A visitor who has never heard of OAuth learns exactly what the assistant may and
may not do, sees where this page actually lives, and hands over a key knowing they can
take it back.
FIRST VIEWPORT: Full-bleed navy band carrying the name and the real host. Below it, on
paper, the question as a heading, then the white key card with its punched slot and brass
edge naming who holds it.
FORM: The Hotel Key Card; candidate 1 of the grounded list, chosen over the roll's
assignment. Seed b59c22d9.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

/** A key, on the band's navy. Drawn in the same grammar as the door marks. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect width='20' height='20' rx='3' fill='%2314384F'/%3E%3Cg fill='none' stroke='%23EFEDE8' stroke-width='1.7' stroke-linecap='round'%3E%3Ccircle cx='6.6' cy='10' r='3'/%3E%3Cpath d='M9.6 10H16'/%3E%3Cpath d='M13.4 10v2.8'/%3E%3Cpath d='M15.6 10v2'/%3E%3C/g%3E%3C/svg%3E";

export function document_(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><link rel="icon" href="${FAVICON}"><link rel="preload" href="/f/a600.woff2" as="font" type="font/woff2" crossorigin><title>${title}</title><style>${CSS}</style></head><body>${CONTRACT}${body}</body></html>`;
}
