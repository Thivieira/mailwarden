import { config } from "../config";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const displayName = args[1];
  const vaultName = args[2];

  if (!email || !displayName) {
    console.error("Usage: bun run src/scripts/invite-user.ts <email> <display-name> [vault-name]");
    process.exit(1);
  }
  if (!config.BETA_ADMIN_SECRET) {
    console.error("BETA_ADMIN_SECRET must be set in the local environment before provisioning a beta user.");
    process.exit(1);
  }

  const response = await fetch(`${config.APP_BASE_URL}/auth/beta/provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.BETA_ADMIN_SECRET}`,
    },
    body: JSON.stringify({ email, displayName, vaultName }),
  });

  const result = await response.json() as any;
  if (!response.ok) {
    console.error(`Provisioning failed (${response.status}): ${result.error || JSON.stringify(result)}`);
    process.exit(1);
  }

  console.log("=================================================");
  console.log(`Mailwarden private beta user: ${displayName} <${result.email}>`);
  console.log("=================================================");
  console.log(`Private vault ID: ${result.tenantId}`);
  console.log(`User ID:          ${result.userId}`);
  console.log(`Login secret:     ${result.loginSecret}`);
  console.log("");
  console.log("Share the login secret with the user through a private channel.");
  console.log("It is only returned during provisioning and is stored by Mailwarden only as a salted hash.");
  console.log(`ChatGPT server:    ${config.APP_BASE_URL}/mcp`);
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Error provisioning private beta user:", err);
  process.exit(1);
});
