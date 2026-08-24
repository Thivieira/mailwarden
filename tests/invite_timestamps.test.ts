/**
 * Invite timestamp encoding.
 *
 * `beta_invites` was written by two paths with different units: the service
 * through Drizzle (`mode: "timestamp"`, seconds) and an operator script through
 * raw SQL (`Date.getTime()`, milliseconds). A millisecond row read back as a date
 * thousands of years out, so its expiry check could never fail.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../src/db";
import { inviteService } from "../src/services/invites";

/** Values above this are milliseconds; as seconds it would be the year 5138. */
const MS_THRESHOLD = 100_000_000_000;

describe("beta invite timestamps", () => {
  test("the service stores seconds, not milliseconds", async () => {
    const invite = await inviteService.createInvite({ expiresInDays: 7 });

    const [row] = await db
      .select({
        expiresAt: sql<number>`expires_at`,
        createdAt: sql<number>`created_at`,
      })
      .from(schema.betaInvites)
      .where(eq(schema.betaInvites.code, invite.code))
      .limit(1);

    expect(row!.expiresAt).toBeLessThan(MS_THRESHOLD);
    expect(row!.createdAt).toBeLessThan(MS_THRESHOLD);
    // And it round-trips to the date the caller was told.
    expect(Math.abs(row!.expiresAt * 1000 - invite.expiresAt.getTime())).toBeLessThan(1000);
  });

  test("buildInvite is the single source the script and the service share", () => {
    const built = inviteService.buildInvite({ email: "  Person@Example.COM ", expiresInDays: 3 });
    expect(built.email).toBe("person@example.com");
    expect(built.code.startsWith("mw_inv_")).toBe(true);
    expect(built.inviteUrl).toContain(built.code);
    const lifetimeDays = (built.expiresAt.getTime() - built.createdAt.getTime()) / 86_400_000;
    expect(Math.round(lifetimeDays)).toBe(3);
  });

  test("an invite whose expiry was written in milliseconds is refused, not honoured forever", async () => {
    const code = `mw_inv_${nanoid(16)}`;
    const farFuture = Date.now() + 7 * 86_400_000; // milliseconds in a seconds column
    await db.run(sql`
      INSERT INTO beta_invites (id, code, email, created_by_user_id, expires_at, used_at, used_by_user_id, created_at)
      VALUES (${nanoid()}, ${code}, NULL, NULL, ${farFuture}, NULL, NULL, ${Date.now()})
    `);

    await expect(inviteService.validateInvite(code)).rejects.toThrow(/not valid/i);
    await db.run(sql`DELETE FROM beta_invites WHERE code = ${code}`);
  });

  test("the normalization migration converts milliseconds and leaves seconds alone", async () => {
    const msCode = `mw_inv_${nanoid(16)}`;
    const secondsCode = `mw_inv_${nanoid(16)}`;
    const expiresMs = Date.now() + 7 * 86_400_000;
    const expiresSeconds = Math.floor(expiresMs / 1000);

    await db.run(sql`
      INSERT INTO beta_invites (id, code, email, created_by_user_id, expires_at, used_at, used_by_user_id, created_at)
      VALUES (${nanoid()}, ${msCode}, NULL, NULL, ${expiresMs}, ${Date.now()}, NULL, ${Date.now()})
    `);
    await db.run(sql`
      INSERT INTO beta_invites (id, code, email, created_by_user_id, expires_at, used_at, used_by_user_id, created_at)
      VALUES (${nanoid()}, ${secondsCode}, NULL, NULL, ${expiresSeconds}, NULL, NULL, ${Math.floor(Date.now() / 1000)})
    `);

    // Split exactly the way src/db/migrate.ts does, comments and all, so this
    // exercises the statements the runner will actually execute.
    const migration = readFileSync(join(import.meta.dir, "..", "migrations", "0008_normalize_beta_invite_timestamps.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await db.run(sql.raw(statement));
    }

    const read = async (code: string) => {
      const [row] = await db
        .select({ expiresAt: sql<number>`expires_at`, usedAt: sql<number | null>`used_at` })
        .from(schema.betaInvites)
        .where(eq(schema.betaInvites.code, code))
        .limit(1);
      return row!;
    };

    const normalized = await read(msCode);
    expect(normalized.expiresAt).toBe(expiresSeconds);
    expect(normalized.usedAt).toBeLessThan(MS_THRESHOLD);

    // A row already in seconds must not be divided again.
    expect((await read(secondsCode)).expiresAt).toBe(expiresSeconds);

    // And the repaired invite now validates like any other.
    await expect(inviteService.validateInvite(msCode)).rejects.toThrow(/already been used/i);

    await db.run(sql`DELETE FROM beta_invites WHERE code IN (${msCode}, ${secondsCode})`);
  });
});
