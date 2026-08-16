import { renderToString } from "solid-js/web";
import { document_ } from "./document";

/**
 * Renders a Solid component to a complete HTML Response.
 *
 * Always returns a real `Response`: Elysia drops a route-set Content-Type on string
 * returns under Cloudflare Workers, which is what made these pages render as literal
 * source in Chrome. A Response is the only reliable carrier.
 */

const BROWSER_HTML_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Styles are inlined and the favicon is a data URI; nothing is fetched, and no script
  // is permitted at all - this page takes credentials.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

export function renderPage<T>(title: string, view: () => T, status = 200): Response {
  return new Response(document_(title, renderToString(view)), {
    status,
    headers: BROWSER_HTML_HEADERS,
  });
}
