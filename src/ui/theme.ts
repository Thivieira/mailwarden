/**
 * Mailwarden's design tokens, shared by every surface that renders.
 *
 * Two very different runtimes consume this: the server-rendered browser pages in
 * `tokens.ts` (zero JS, one hash-pinned script) and the MCP App UIs in `src/mcp/ui`
 * (bundled JS inside a host-controlled sandboxed iframe). They must not drift, so the
 * palette lives here once and both interpolate it.
 *
 * Hues are held constant per family so the ramp stays coherent:
 * navy 245, paper 85, brass 82, green 160, red 27.
 */
export const TOKENS = `
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
`.trim();

/** The seal: a shield whose body is also an envelope. Authored, held to Lucide's spec. */
export const SEAL_PATHS = `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m7.5 9.5 4.5 3.5 4.5-3.5"/>`;
