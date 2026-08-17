import { SignJWT, jwtVerify } from "jose";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";
import { config } from "../config";
import { auditService } from "./audit";
import { AuthenticationError } from "../utils/errors";

/**
 * Human browser sessions — a token class deliberately incompatible with API/MCP bearers.
 *
 * WHY THIS EXISTS
 * Send approval used to accept a matching `confirmationNonce` as a substitute for
 * authentication, and the review page that renders that nonce required no auth at all. So
 * anything holding the review URL — including the AI client that was handed it — could GET
 * the page, read the nonce, POST it back, and confirm its own send. The human-in-the-loop
 * guarantee rested on the assumption that a model would not fetch a URL it was given.
 *
 * THE SEPARATION
 * `auth.ts` signs API tokens with `aud = APP_BASE_URL` and verifies with that same
 * audience. These are signed with `aud = APP_BASE_URL + "/human-session"`, so jose's own
 * audience check makes the two classes mutually unverifiable:
 *
 *     API JWT   -> verifyToken() ok        -> verifyHumanSession() rejected (audience)
 *     Human JWT -> verifyHumanSession() ok -> verifyToken() rejected (audience)
 *
 * That matters: without it, fixing the nonce bypass would have quietly made a stolen MCP
 * bearer token able to confirm sends. `typ`, `kind` and an empty-scopes assertion are
 * checked on top so a future refactor cannot collapse the classes by accident.
 *
 * A human session carries NO mail scopes. It authorizes exactly one thing: acting as the
 * human on approval surfaces. It is not, and must never become, a general API credential.
 *
 * STORAGE
 * Reuses the existing `sessions` table — no migration. The row is the revocation record:
 * the table has no `revokedAt`, so revoking means deleting the row, and verification
 * requires the exact `sessionId + tokenHash` row to still exist and be unexpired. That
 * mirrors how `verifyToken` already validates API sessions.
 */

export const HUMAN_SESSION_COOKIE = "mw_human_session";

/** Short by design: it authorizes irreversible sends, and re-auth is one form away. */
const TTL_HOURS = 2;

const HUMAN_TYP = "MW-HUMAN-SESSION";
const HUMAN_KIND = "human";

function humanAudience(): string {
  return `${config.APP_BASE_URL}/human-session`;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(config.AUTH_SECRET);
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface HumanSession {
  tenantId: string;
  userId: string;
  sessionId: string;
  email: string;
}

export class HumanSessionService {
  /**
   * Called on the one authentication event we already have: a successful sign-in during
   * the OAuth authorize POST. Reusing it means the person does not log in twice.
   */
  async mint(user: {
    id: string;
    tenantId: string;
    email: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const sessionId = nanoid();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);

    const token = await new SignJWT({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      sessionId,
      kind: HUMAN_KIND,
      // Explicitly empty. A human session never carries mail authority.
      scopes: [],
    })
      .setProtectedHeader({ alg: "HS256", typ: HUMAN_TYP })
      .setIssuer(config.APP_BASE_URL)
      .setAudience(humanAudience())
      .setIssuedAt()
      .setExpirationTime(`${TTL_HOURS}h`)
      .sign(secret());

    await db.insert(schema.sessions).values({
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: hashOf(token),
      scopes: [],
      expiresAt,
      createdAt: new Date(),
    });

    await auditService.logEvent({
      tenantId: user.tenantId,
      userId: user.id,
      action: "HUMAN_SESSION_START",
      resourceType: "session",
      resourceId: sessionId,
      details: { ttlHours: TTL_HOURS },
    });

    return { token, expiresAt };
  }

  /** Mint a fresh session and revoke any prior human cookie to prevent fixation. */
  async mintRotating(
    user: { id: string; tenantId: string; email: string },
    priorCookieToken?: string
  ): Promise<{ token: string; expiresAt: Date }> {
    if (priorCookieToken) {
      const prior = await this.tryVerify(priorCookieToken);
      if (prior) await this.revoke(prior.sessionId);
    }
    return this.mint(user);
  }

  /**
   * Throws unless the token is a live human session. Every check is load-bearing; do not
   * relax one because "the signature already proves it".
   */
  async verify(tokenInput: string | undefined): Promise<HumanSession> {
    if (!tokenInput) throw new AuthenticationError("Human session required");

    let payload: Record<string, unknown>;
    let protectedHeader: Record<string, unknown>;
    try {
      // Audience is what makes an API bearer fail here.
      const verified = await jwtVerify(tokenInput.trim(), secret(), {
        issuer: config.APP_BASE_URL,
        audience: humanAudience(),
      });
      payload = verified.payload as Record<string, unknown>;
      protectedHeader = verified.protectedHeader as Record<string, unknown>;
    } catch {
      throw new AuthenticationError("Human session is invalid or has expired");
    }

    if (protectedHeader.typ !== HUMAN_TYP || payload.kind !== HUMAN_KIND) {
      throw new AuthenticationError("Not a human session token");
    }

    // A human session that somehow carries scopes is a token-class confusion bug, not a
    // more capable session. Refuse it.
    const scopes = payload.scopes;
    if (!Array.isArray(scopes) || scopes.length > 0) {
      throw new AuthenticationError("Human session must carry no scopes");
    }

    const userId = payload.sub as string | undefined;
    const tenantId = payload.tenantId as string | undefined;
    const sessionId = payload.sessionId as string | undefined;
    if (!userId || !tenantId || !sessionId) {
      throw new AuthenticationError("Human session payload is incomplete");
    }

    // The row is the revocation record: deleting it ends the session immediately.
    const [row] = await db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.tokenHash, hashOf(tokenInput.trim()))))
      .limit(1);

    if (!row || row.expiresAt < new Date()) {
      throw new AuthenticationError("Human session has expired or been revoked");
    }
    if (row.userId !== userId || row.tenantId !== tenantId) {
      throw new AuthenticationError("Human session does not match its stored record");
    }

    return { tenantId, userId, sessionId, email: (payload.email as string) || "" };
  }

  /** Best-effort read: returns null instead of throwing, for surfaces that offer sign-in. */
  async tryVerify(tokenInput: string | undefined): Promise<HumanSession | null> {
    try {
      return await this.verify(tokenInput);
    } catch {
      return null;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  }
}

export const humanSessionService = new HumanSessionService();

/**
 * SameSite=Lax is the deliberate choice: the person clicks the review link from inside
 * ChatGPT, which is a top-level cross-site GET navigation — Lax sends the cookie for that
 * while still withholding it from cross-site POSTs to /confirm. Strict would break the
 * click-through entirely; None would weaken the CSRF property this provides.
 */
export function humanSessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${HUMAN_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure is mandatory in production; omitted on plain-HTTP localhost so dev works.
  if (config.APP_BASE_URL.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

export function clearHumanSessionCookie(): string {
  return `${HUMAN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Reads the cookie without pulling in a cookie library for one header. */
export function readHumanSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === HUMAN_SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function humanSessionMaxAge(expiresAt: Date): number {
  return Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}
