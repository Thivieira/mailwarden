import { Hono } from "hono";
import { FONTS } from "../../ui/fonts.gen";
import { ICON_PNG_B64 } from "../../ui/icon.gen";

/**
 * The display face, served same-origin so the pages need no third-party request and the
 * CSP can stay at `font-src 'self'`. Immutable, so a visitor fetches each weight once ever.
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

let decodedIcon: Uint8Array | null = null;
function getIconBytes(): Uint8Array {
  if (!decodedIcon) {
    const bin = atob(ICON_PNG_B64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    decodedIcon = out;
  }
  return decodedIcon;
}

export const fontRoutes = new Hono()
  .get("/f/:name", (c) => {
    const bytes = bytesFor(c.req.param("name").replace(/\.woff2$/, ""));
    if (!bytes) return c.json({ error: "not_found" }, 404);

    return new Response(bytes, {
      headers: {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })
  .get("/mailwarden.png", (c) => {
    return new Response(getIconBytes(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })
  .get("/icon.png", (c) => {
    return new Response(getIconBytes(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
