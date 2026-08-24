import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";
import { config } from "../config";
import { AuthenticationError } from "../utils/errors";
import { auditService } from "./audit";

export type InviteStatus = "active" | "used" | "expired";

export type BetaInvite = {
  id: string;
  code: string;
  email: string | null;
  createdByUserId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  usedByUserId: string | null;
  createdAt: Date;
  status: InviteStatus;
  inviteUrl: string;
};

/** Invites are short-lived by design; anything beyond this is corrupt data. */
const MAX_INVITE_LIFETIME_MS = 400 * 24 * 60 * 60 * 1000;

export class InviteService {
  async hasAnyUsers(): Promise<boolean> {
    const users = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return users.length > 0;
  }

  /**
   * Builds an invite record without writing it.
   *
   * Exists so the operator script and the service cannot disagree about ids,
   * codes, or timestamp units: whoever writes the row starts from this.
   */
  buildInvite(input: { createdByUserId?: string; email?: string; expiresInDays?: number }): {
    id: string;
    code: string;
    email: string | null;
    createdByUserId: string | null;
    createdAt: Date;
    expiresAt: Date;
    inviteUrl: string;
  } {
    const now = new Date();
    const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 7;
    const code = `mw_inv_${nanoid(16)}`;
    return {
      id: nanoid(),
      code,
      email: input.email ? input.email.trim().toLowerCase() : null,
      createdByUserId: input.createdByUserId || null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      inviteUrl: `${config.APP_BASE_URL}/portal/signup?invite=${code}`,
    };
  }

  async createInvite(input: {
    createdByUserId?: string;
    email?: string;
    expiresInDays?: number;
  }): Promise<BetaInvite> {
    const built = this.buildInvite(input);
    const { id, code, expiresAt, createdAt: now } = built;
    const normalizedEmail = built.email;
    const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 7;

    await db.insert(schema.betaInvites).values({
      id,
      code,
      email: normalizedEmail,
      createdByUserId: input.createdByUserId || null,
      expiresAt,
      createdAt: now,
    });

    if (input.createdByUserId) {
      await auditService.logEvent({
        tenantId: "system",
        userId: input.createdByUserId,
        action: "INVITE_CREATED" as any,
        resourceType: "invite",
        resourceId: id,
        details: { email: normalizedEmail, expiresInDays: days },
      });
    }

    return {
      id,
      code,
      email: normalizedEmail,
      createdByUserId: input.createdByUserId || null,
      expiresAt,
      usedAt: null,
      usedByUserId: null,
      createdAt: now,
      status: "active",
      inviteUrl: `${config.APP_BASE_URL}/portal/signup?invite=${code}`,
    };
  }

  async validateInvite(code: string, email?: string): Promise<typeof schema.betaInvites.$inferSelect> {
    if (!code || !code.trim()) {
      throw new AuthenticationError("A valid invite code is required to register during private beta");
    }

    const cleanCode = code.trim();
    const [invite] = await db
      .select()
      .from(schema.betaInvites)
      .where(eq(schema.betaInvites.code, cleanCode))
      .limit(1);

    if (!invite) {
      throw new AuthenticationError("Invalid invite code. Please request an invite link.");
    }

    if (invite.usedAt) {
      throw new AuthenticationError("This invite code has already been used.");
    }

    const expiresAt = new Date(invite.expiresAt);
    if (expiresAt < new Date()) {
      throw new AuthenticationError("This invite link has expired. Please ask for a new invite.");
    }
    // A date far beyond any real invite means the row was written with the wrong
    // timestamp unit, which would silently disable expiry. Refuse it rather than
    // honour an invite that can never expire.
    if (expiresAt.getTime() > Date.now() + MAX_INVITE_LIFETIME_MS) {
      throw new AuthenticationError("This invite code is not valid. Please request a new invite link.");
    }

    if (invite.email && email) {
      const normalized = email.trim().toLowerCase();
      if (invite.email.toLowerCase() !== normalized) {
        throw new AuthenticationError(
          `This invite code was specifically reserved for ${invite.email}`
        );
      }
    }

    return invite;
  }

  async consumeInvite(code: string, userId: string): Promise<void> {
    const now = new Date();
    await db
      .update(schema.betaInvites)
      .set({
        usedAt: now,
        usedByUserId: userId,
      })
      .where(eq(schema.betaInvites.code, code.trim()));
  }

  async listInvites(createdByUserId?: string): Promise<BetaInvite[]> {
    const rows = createdByUserId
      ? await db
          .select()
          .from(schema.betaInvites)
          .where(eq(schema.betaInvites.createdByUserId, createdByUserId))
          .orderBy(desc(schema.betaInvites.createdAt))
      : await db
          .select()
          .from(schema.betaInvites)
          .orderBy(desc(schema.betaInvites.createdAt))
          .limit(50);

    const now = new Date();
    return rows.map((r: any) => {
      let status: InviteStatus = "active";
      if (r.usedAt) {
        status = "used";
      } else if (new Date(r.expiresAt) < now) {
        status = "expired";
      }

      return {
        id: r.id,
        code: r.code,
        email: r.email,
        createdByUserId: r.createdByUserId,
        expiresAt: new Date(r.expiresAt),
        usedAt: r.usedAt ? new Date(r.usedAt) : null,
        usedByUserId: r.usedByUserId,
        createdAt: new Date(r.createdAt),
        status,
        inviteUrl: `${config.APP_BASE_URL}/portal/signup?invite=${r.code}`,
      };
    });
  }
}

export const inviteService = new InviteService();
