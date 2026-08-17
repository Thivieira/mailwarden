import { CSS } from "./tokens";

/**
 * Wraps SSR-rendered body markup in the full document. Written as a string function
 * rather than a component so the emitted bytes are exact: doctype, inlined critical CSS,
 * the font preload, and the direction contract as a real HTML comment that survives the
 * build.
 */

const CONTRACT = `<!--
THESIS: An OAuth consent screen in shadcn/ui New York, the system a Next.js app would
ship. Cards carry the structure; the page states plainly what the assistant will and will
never be able to do.
OWN-WORLD: shadcn New York's bones - oklch tokens light and dark, Geist variable, cards at
radius-xl, h-9 controls, the 3px focus ring - carrying four things that are Mailwarden's
alone: the authored seal (a shield whose body is also an envelope, the only brass on the
page), material rather than colour for polarity (granted powers raised, refused ones
pressed into the ground), ledger rules behind the opening in place of the usual dot field,
and the browser's own surfaces themed. The look is shadcn's; the runtime is not - zero
client JavaScript ships.
STORY: A visitor who has never heard of OAuth reads what they are granting, sees where
the page actually lives, and signs in knowing they can revoke it.
FIRST VIEWPORT: Sticky bordered header with the wordmark and the real host. Below it the
question as a tight heading, a muted lede, then the grant subject as an account row with
a Revocable badge.
FORM: shadcn/ui New York, requested by the user. Seed b59c22d9 (world replaced).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

/** Lucide's key-round on the neutral swatch. Kept at the user's request (2026-08-17): the
 *  header mark is the seal, but the tab icon stays the key. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23262626'/%3E%3Cg transform='translate(4 4)' fill='none' stroke='%23FAFAFA' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'/%3E%3Ccircle cx='16.5' cy='7.5' r='.5' fill='%23FAFAFA'/%3E%3C/g%3E%3C/svg%3E";

/**
 * `script` is admitted by a CSP hash of its exact bytes (see render.ts). It is emitted last
 * so the DOM it wires up already exists, and it is never interpolated from request data -
 * the only value that reaches it is the constant in peek.ts.
 */
export function document_(title: string, body: string, script?: string): string {
  const tail = script ? `<script>${script}</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><link rel="icon" href="${FAVICON}"><link rel="preload" href="/f/geist.woff2" as="font" type="font/woff2" crossorigin><title>${title}</title><style>${CSS}</style></head><body>${CONTRACT}${body}${tail}</body></html>`;
}
