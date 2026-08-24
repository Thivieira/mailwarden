#!/usr/bin/env bun
import { inviteService } from "../src/services/invites";
import { db, schema } from "../src/db";

const PROD_BASE_URL = "https://mailwarden.corenet.workers.dev";
const CF_ACCOUNT_ID = "e807ef39b360b2fa610967e74892c610";

/** SQLite string literal: the only user-supplied value here is an email address. */
function quote(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

/** Drizzle's `mode: "timestamp"` columns are seconds, not milliseconds. */
function toDbSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

async function main() {
  const args = process.argv.slice(2);
  const isRemote = args.includes("--remote") || args.includes("--prod") || process.env.NODE_ENV === "production";
  const cleanArgs = args.filter((a) => !a.startsWith("--"));

  const email = cleanArgs[0] && cleanArgs[0].includes("@") ? cleanArgs[0] : undefined;
  const days = cleanArgs[1] ? Number(cleanArgs[1]) : cleanArgs[0] && !cleanArgs[0].includes("@") ? Number(cleanArgs[0]) : 7;

  // One record, whichever database it lands in: the code printed below is always
  // the code that was stored, and both paths write seconds.
  const invite = inviteService.buildInvite({ email, expiresInDays: days });

  if (isRemote) {
    console.log("Creating private beta invite directly in Cloudflare D1 (mailwarden-prod)...");
    const sql =
      "INSERT INTO beta_invites (id, code, email, created_by_user_id, expires_at, created_at) VALUES (" +
      [
        quote(invite.id),
        quote(invite.code),
        quote(invite.email),
        "NULL",
        String(toDbSeconds(invite.expiresAt)),
        String(toDbSeconds(invite.createdAt)),
      ].join(", ") +
      ");";

    const proc = Bun.spawnSync([
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "mailwarden-prod",
      "--remote",
      `--command=${sql}`,
    ], {
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID,
      },
    });

    if (proc.exitCode !== 0) {
      console.error("D1 execution failed:", proc.stderr.toString());
      process.exit(1);
    }
  } else {
    await db.insert(schema.betaInvites).values({
      id: invite.id,
      code: invite.code,
      email: invite.email,
      createdByUserId: invite.createdByUserId,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    });
  }

  const prodInviteUrl = `${PROD_BASE_URL}/portal/signup?invite=${invite.code}`;

  console.log("\n=================================================");
  console.log("🛡️  MAILWARDEN ONE-TIME BETA INVITE CREATED");
  console.log("=================================================");
  console.log(`Invite Code:   ${invite.code}`);
  if (invite.email) {
    console.log(`Locked Email:  ${invite.email}`);
  }
  console.log(`Expires At:    ${invite.expiresAt.toISOString()} (${days} days)`);
  console.log(`\n👉 One-Time Signup Link (${isRemote ? "Production" : "Local"}):`);
  console.log(`\x1b[36m\x1b[1m${isRemote ? prodInviteUrl : invite.inviteUrl}\x1b[0m`);
  console.log("=================================================");
  console.log("Share this link with your tester. It burns automatically after one use.\n");
}

main().catch((err) => {
  console.error("Failed to create invite:", err);
  process.exit(1);
});
