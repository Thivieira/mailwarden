import { renderToString } from "solid-js/web";
import { document_ } from "./document";
import { PEEK_SCRIPT } from "./peek";
import { PEEK_SHA256 } from "./peek.gen";

/**
 * Renders a Solid component to a complete HTML Response.
 *
 * Always returns a real `Response`: Elysia dropped a route-set Content-Type on string
 * returns under Cloudflare Workers, which is what made these pages render as literal
 * source in Chrome. A Response is the only reliable carrier.
 */

const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self'; form-action 'self' https: http:; base-uri 'none'; frame-ancestors 'none'";

const PEEK_CSP = BASE_CSP.replace("default-src 'none';", `default-src 'none'; script-src '${PEEK_SHA256}';`);
const DASHBOARD_CSP = BASE_CSP.replace("default-src 'none';", "default-src 'none'; script-src 'unsafe-inline';").replace("img-src data:;", "img-src 'self' data:;");

const BROWSER_HTML_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Styles are inlined, the favicon is a data URI, and the display face is served from
  // this origin. No third party is reachable.
  "Content-Security-Policy": BASE_CSP,
};

/**
 * `peek` is a boolean rather than a script parameter on purpose: a caller can turn the one
 * known script on, and can never hand this function arbitrary JavaScript to inline.
 */
export function renderPage<T>(
  title: string,
  view: () => T,
  status = 200,
  options: { peek?: boolean; allowScripts?: boolean } = {}
): Response {
  const script = options.peek ? PEEK_SCRIPT : undefined;
  const cspHeader = options.allowScripts
    ? DASHBOARD_CSP
    : options.peek
    ? PEEK_CSP
    : BASE_CSP;

  const headers = { ...BROWSER_HTML_HEADERS, "Content-Security-Policy": cspHeader };

  return new Response(document_(title, renderToString(view), script), { status, headers });
}
