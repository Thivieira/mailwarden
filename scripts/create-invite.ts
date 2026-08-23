#!/usr/bin/env bun
import { nanoid } from "nanoid";
import { inviteService } from "../src/services/invites";
import { config } from "../src/config";

const PROD_BASE_URL = "https://mailwarden.corenet.workers.dev";
const CF_ACCOUNT_ID = "e807ef39b360b2fa610967e74892c610";

async function main() {
  const args = process.argv.slice(2);
  const isRemote = args.includes("--remote") || args.includes("--prod") || process.env.NODE_ENV === "production";
  const cleanArgs = args.filter((a) => !a.startsWith("--"));

  const email = cleanArgs[0] && cleanArgs[0].includes("@") ? cleanArgs[0] : undefined;
  const days = cleanArgs[1] ? Number(cleanArgs[1]) : cleanArgs[0] && !cleanArgs[0].includes("@") ? Number(cleanArgs[0]) : 7;

  const id = nanoid();
  const code = `mw_inv_${nanoid(16)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const normalizedEmail = email ? email.trim().toLowerCase() : null;

  if (isRemote) {
    console.log("Creating private beta invite directly in Cloudflare D1 (mailwarden-prod)...");
    const sql = `INSERT INTO beta_invites (id, code, email, created_by_user_id, expires_at, created_at) VALUES ('${id}', '${code}', ${normalizedEmail ? `'${normalizedEmail}'` : "NULL"}, NULL, ${expiresAt.getTime()}, ${now.getTime()});`;

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
    // Local SQLite insert
    await inviteService.createInvite({
      email: normalizedEmail || undefined,
      expiresInDays: days,
    });
  }

  const prodInviteUrl = `${PROD_BASE_URL}/portal/signup?invite=${code}`;

  console.log("\n=================================================");
  console.log("🛡️  MAILWARDEN ONE-TIME BETA INVITE CREATED");
  console.log("=================================================");
  console.log(`Invite Code:   ${code}`);
  if (normalizedEmail) {
    console.log(`Locked Email:  ${normalizedEmail}`);
  }
  console.log(`Expires At:    ${expiresAt.toISOString()} (${days} days)`);
  console.log(`\n👉 One-Time Signup Link (Production):`);
  console.log(`\x1b[36m\x1b[1m${prodInviteUrl}\x1b[0m`);
  console.log("=================================================");
  console.log("Share this link with your tester. It burns automatically after one use.\n");
}

main().catch((err) => {
  console.error("Failed to create invite:", err);
  process.exit(1);
});
