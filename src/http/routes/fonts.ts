import { Elysia } from "elysia";
import { FONTS } from "../../ui/fonts.gen";

/**
 * The display face, served same-origin so the pages need no third-party request and the
 * CSP can stay at `font-src 'self'`. Content-hashed by weight and immutable, so a visitor
 * fetches each weight once ever.
 */
const decoded = new Map<string, Uint8Array>();

function bytesFor(name: string): Uint8Array | null {
  if (!decoded.has(name)) {
    const b64 = (FONTS as Record<string, string>)[name];
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    decoded.set(name, out);
  }
  return decoded.get(name) ?? null;
}

export const fontRoutes = new Elysia({ aot: false }).get("/f/:name", ({ params, set }) => {
  const bytes = bytesFor(params.name.replace(/\.woff2$/, ""));
  if (!bytes) {
    set.status = 404;
    return { error: "not_found" };
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
