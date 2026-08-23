#!/usr/bin/env bun
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BASE_URL = process.env.MAILWARDEN_URL || "https://mailwarden.corenet.workers.dev";

// ANSI colors for clean terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

async function logStep(step: number, title: string) {
  console.log(`\n${colors.bold}${colors.cyan}[Step ${step}]${colors.reset} ${colors.bold}${title}${colors.reset}`);
}

async function callMcpTool(token: string, name: string, args: Record<string, any> = {}) {
  const res = await fetch(`${BASE_URL}/mcp/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `call_${Date.now()}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }),
  });

  const data = (await res.json()) as any;
  if (data.error) {
    throw new Error(`MCP Error (${name}): ${data.error.message || JSON.stringify(data.error)}`);
  }

  const contentText = data.result?.content?.[0]?.text;
  if (contentText) {
    try {
      return JSON.parse(contentText);
    } catch {
      return contentText;
    }
  }
  return data.result;
}

async function main() {
  console.log(`
${colors.bold}${colors.magenta}╔════════════════════════════════════════════════════════════════╗
║                🛡️  MAILWARDEN LIVE TEST RUNNER                ║
║           "Your email, managed through conversation"           ║
╚════════════════════════════════════════════════════════════════╝${colors.reset}
  Target Origin: ${colors.blue}${BASE_URL}${colors.reset}
`);

  const rl = readline.createInterface({ input, output });

  // -------------------------------------------------------------
  // STEP 1: Health Check
  // -------------------------------------------------------------
  await logStep(1, "Checking Mailwarden Production Health...");
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = (await healthRes.json()) as any;
    console.log(`${colors.green}✔ Health Status:${colors.reset} ${health.status} (v${health.version})`);
    console.log(`  - Database: ${colors.green}${health.checks.database}${colors.reset}`);
    console.log(`  - Encryption: ${colors.green}${health.checks.encryption}${colors.reset}`);
    console.log(`  - Dry-Run Safe Mode: ${health.checks.mailboxMutationsEnabled ? colors.red + "LIVE MUTATIONS" : colors.green + "SIMULATION ONLY (Safe)"}${colors.reset}`);
    console.log(`  - Google OAuth Configured: ${health.checks.googleConfigured ? colors.green + "YES" : colors.yellow + "NO (Needs secrets)"}${colors.reset}`);
  } catch (err: any) {
    console.error(`${colors.red}✖ Failed to reach Mailwarden at ${BASE_URL}:${colors.reset}`, err.message);
    rl.close();
    process.exit(1);
  }

  // -------------------------------------------------------------
  // STEP 2: Authenticate & Obtain Token
  // -------------------------------------------------------------
  await logStep(2, "Authenticating User...");
  let email = process.env.OWNER_EMAIL || "";
  let secret = process.env.OWNER_LOGIN_SECRET || "";

  if (!email) {
    email = await rl.question(`${colors.yellow}Enter your email address:${colors.reset} `);
  } else {
    console.log(`Using email from env: ${colors.cyan}${email}${colors.reset}`);
  }

  if (!secret) {
    secret = await rl.question(`${colors.yellow}Enter your login secret (16+ chars):${colors.reset} `);
  } else {
    console.log(`Using secret from env: ${colors.gray}******${colors.reset}`);
  }

  let token = "";
  try {
    const tokenRes = await fetch(`${BASE_URL}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), loginSecret: secret.trim(), displayName: email.split("@")[0] }),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData.error || `HTTP ${tokenRes.status}`);
    }

    token = tokenData.token;
    console.log(`${colors.green}✔ Authenticated successfully!${colors.reset}`);
    console.log(`  Tenant ID: ${colors.gray}${tokenData.tenantId}${colors.reset}`);
    console.log(`  User ID:   ${colors.gray}${tokenData.userId}${colors.reset}`);
  } catch (err: any) {
    console.error(`${colors.red}✖ Authentication failed:${colors.reset}`, err.message);
    console.log(`\n${colors.yellow}Tip:${colors.reset} If you haven't set the OWNER credentials on Cloudflare yet, run:\n` +
      `  ${colors.bold}bunx wrangler secret put OWNER_EMAIL${colors.reset}\n` +
      `  ${colors.bold}bunx wrangler secret put OWNER_LOGIN_SECRET${colors.reset}\n`);
    rl.close();
    process.exit(1);
  }

  // -------------------------------------------------------------
  // STEP 3: Check Connected Accounts
  // -------------------------------------------------------------
  await logStep(3, "Checking Connected Mailboxes...");
  let statusSummary: any = null;
  try {
    statusSummary = await callMcpTool(token, "get_inbox_status");
  } catch (err: any) {
    console.log(`${colors.yellow}Could not fetch inbox status:${colors.reset}`, err.message);
  }

  const accounts = statusSummary?.accounts || [];
  if (accounts.length === 0) {
    console.log(`${colors.yellow}No email accounts connected to this vault yet.${colors.reset}`);
    console.log(`\nLet's connect your Gmail or Outlook account:`);

    try {
      const connectRes = await fetch(`${BASE_URL}/api/connect/google?mode=full`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const connectData = (await connectRes.json()) as any;

      if (connectData.authUrl) {
        console.log(`\n${colors.bold}${colors.green}👉 Click here to connect Gmail:${colors.reset}`);
        console.log(`${colors.cyan}${connectData.authUrl}${colors.reset}\n`);
        console.log(`After signing in, return here and press Enter to continue.`);
        await rl.question(`Press [Enter] after approving Gmail in your browser...`);
      } else {
        console.log(`${colors.yellow}Google OAuth credentials not configured on Worker.${colors.reset}`);
        console.log(`Set ${colors.bold}GOOGLE_CLIENT_ID${colors.reset} and ${colors.bold}GOOGLE_CLIENT_SECRET${colors.reset} via wrangler secrets to connect Gmail.`);
      }
    } catch (err: any) {
      console.log(`${colors.yellow}Note:${colors.reset}`, err.message);
    }
  } else {
    console.log(`${colors.green}✔ Found ${accounts.length} connected account(s):${colors.reset}`);
    for (const acc of accounts) {
      console.log(`  - [${acc.provider.toUpperCase()}] ${colors.bold}${acc.emailAddress}${colors.reset} (Role: ${acc.priorityRole}, Status: ${acc.status})`);
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Live Executive Email Briefing
  // -------------------------------------------------------------
  await logStep(4, "Generating Live Executive Briefing...");
  try {
    console.log(`${colors.gray}Fetching attention queue and open loops...${colors.reset}`);

    const [inboxStatus, attentionQueue, waitingForUser, userWaitingFor] = await Promise.all([
      callMcpTool(token, "get_inbox_status").catch(() => null),
      callMcpTool(token, "get_attention_queue", { limit: 10 }).catch(() => null),
      callMcpTool(token, "get_waiting_for_me").catch(() => null),
      callMcpTool(token, "get_user_waiting_for").catch(() => null),
    ]);

    console.log(`\n${colors.bold}${colors.green}══════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}☕ YOUR LIVE DAILY BRIEFING${colors.reset}`);
    console.log(`${colors.bold}${colors.green}══════════════════════════════════════════════════════════════════${colors.reset}`);

    // Overview stats
    if (inboxStatus) {
      console.log(`\n${colors.bold}📊 Inbox Overview:${colors.reset}`);
      console.log(`  - Total Unread: ${colors.cyan}${inboxStatus.totalUnread ?? 0}${colors.reset}`);
      console.log(`  - Attention Needed: ${colors.yellow}${inboxStatus.attentionNeeded ?? 0}${colors.reset}`);
      if (inboxStatus.providerWarnings?.length) {
        for (const w of inboxStatus.providerWarnings) {
          console.log(`  - ⚠️  ${colors.yellow}${w}${colors.reset}`);
        }
      }
    }

    // High Attention Items
    const items = attentionQueue?.items || [];
    console.log(`\n${colors.bold}🚨 What Needs Your Attention (${items.length} items):${colors.reset}`);
    if (items.length === 0) {
      console.log(`  ${colors.green}✔ No urgent emails waiting! Your inbox is under control.${colors.reset}`);
    } else {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        console.log(`  ${i + 1}. ${colors.bold}${it.subject || "(No Subject)"}${colors.reset}`);
        console.log(`     From: ${it.from?.name || ""} <${it.from?.address || "unknown"}> [${it.classification || "routine"}]`);
        if (it.reason) console.log(`     Why: ${colors.gray}${it.reason}${colors.reset}`);
      }
    }

    // Open Loops
    const oweList = waitingForUser?.items || [];
    console.log(`\n${colors.bold}⏳ Who Is Waiting for You (${oweList.length}):${colors.reset}`);
    if (oweList.length === 0) {
      console.log(`  ${colors.gray}None pending.${colors.reset}`);
    } else {
      for (const item of oweList.slice(0, 5)) {
        console.log(`  - ${colors.bold}${item.from?.name || item.from?.address}${colors.reset}: "${item.subject}"`);
      }
    }

    const waitingList = userWaitingFor?.items || [];
    console.log(`\n${colors.bold}📬 Who You Are Waiting On (${waitingList.length}):${colors.reset}`);
    if (waitingList.length === 0) {
      console.log(`  ${colors.gray}None pending.${colors.reset}`);
    } else {
      for (const item of waitingList.slice(0, 5)) {
        console.log(`  - ${colors.bold}${item.to?.[0]?.name || item.to?.[0]?.address}${colors.reset}: "${item.subject}"`);
      }
    }
  } catch (err: any) {
    console.log(`${colors.yellow}Note during briefing:${colors.reset}`, err.message);
  }

  // -------------------------------------------------------------
  // STEP 5: AI Client Connection Snippet
  // -------------------------------------------------------------
  await logStep(5, "Ready to Connect to ChatGPT / Claude / Cursor!");
  console.log(`
${colors.bold}To connect Claude Desktop or Cursor MCP:${colors.reset}
Add this snippet to your configuration:

${colors.cyan}{
  "mcpServers": {
    "mailwarden": {
      "url": "${BASE_URL}/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}${colors.reset}

${colors.bold}To connect ChatGPT Custom GPT Action:${colors.reset}
- Server URL: ${colors.cyan}${BASE_URL}${colors.reset}
- Auth Type:  ${colors.cyan}Bearer${colors.reset}
- Token:      ${colors.cyan}${token}${colors.reset}
`);

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
