import { authService } from "../services/auth";
import { config } from "../config";
import { nanoid } from "nanoid";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0] || "boss@company.com";
  const displayName = args[1] || "Boss";
  const orgName = args[2] || "Executive Office";

  console.log("=================================================");
  console.log(`🛡️ Provisioning Isolated Tenant & MCP Credentials for: ${displayName} <${email}>`);
  console.log("=================================================");

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + nanoid(6);

  const { tenantId, userId, token } = await authService.createTenantAndOwner({
    tenantName: orgName,
    slug,
    ownerEmail: email,
    ownerDisplayName: displayName,
  });

  console.log("\n✅ Account Provisioned Successfully!");
  console.log(`👤 User ID:        ${userId}`);
  console.log(`🏢 Tenant ID:      ${tenantId}`);
  console.log(`📧 User Email:     ${email}`);
  console.log(`🔑 Bearer Token:   ${token}`);
  console.log("\n📡 Production Hardened Endpoints (Standard Bearer Auth):");
  console.log(`- MCP JSON-RPC:                    ${config.MCP_BASE_URL}/rpc`);
  console.log(`  (Header: Authorization: Bearer <TOKEN>)`);
  console.log(`- MCP SSE Stream:                  ${config.MCP_BASE_URL}/sse`);
  console.log(`  (Header: Authorization: Bearer <TOKEN> or single-use ?ticket from POST /auth/stream-ticket)`);
  console.log("\n🔒 Security Invariants:");
  console.log("1. Multi-tenant cryptographic separation with true 2-tier Envelope Encryption (per-record DEK + KEK).");
  console.log("2. Zero credentials or long-lived tokens in URL paths or query strings.");
  console.log("3. Sending requires explicit user confirmation with SHA-256 payload hash matching.");
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("Error provisioning user:", err);
  process.exit(1);
});
