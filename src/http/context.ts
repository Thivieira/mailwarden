import type { Context, MiddlewareHandler } from "hono";
import { authService } from "../services/auth";
import type { AuthPrincipal } from "../types/auth";

/**
 * Shared Hono plumbing.
 *
 * Elysia parsed every request body into `body` regardless of content type. Hono makes the
 * caller choose, and the OAuth endpoints legitimately receive both: browsers post the
 * authorize form as `application/x-www-form-urlencoded`, while OAuth clients post JSON to
 * the token endpoint. `readBody` restores the one behaviour we depended on.
 */

export type Env = {
  Variables: {
    principal: AuthPrincipal | null;
  };
};

/** Parses a JSON or form-encoded body into a plain object. Never throws on a bad body. */
export async function readBody(c: Context): Promise<Record<string, any>> {
  const type = c.req.header("content-type") || "";
  try {
    if (type.includes("application/json")) {
      return (await c.req.json()) ?? {};
    }
    if (type.includes("form-urlencoded") || type.includes("multipart/form-data")) {
      return (await c.req.parseBody()) as Record<string, any>;
    }
    // No usable content-type: try JSON, then form, before giving up.
    const raw = await c.req.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    return {};
  }
}

/** Query parameters as a plain object, matching Elysia's `query`. */
export function readQuery(c: Context): Record<string, string> {
  return c.req.query();
}

/**
 * Resolves the bearer token into a principal, or null. Never rejects: routes decide
 * whether a missing principal is fatal, exactly as they did under `.derive()`.
 */
export const withPrincipal: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header) {
    c.set("principal", null);
    return next();
  }
  try {
    c.set("principal", await authService.verifyToken(header));
  } catch {
    c.set("principal", null);
  }
  return next();
};
