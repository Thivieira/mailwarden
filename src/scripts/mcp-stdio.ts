import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server";
import { authService } from "../services/auth";
import { db, schema } from "../db";
import { ALL_SCOPES, type AuthPrincipal } from "../types/auth";
import { logger } from "../utils/logger";

async function main() {
  const token = process.env.MAILWARDEN_TOKEN || process.env.AUTH_TOKEN;

  let principal: AuthPrincipal;

  if (token) {
    principal = await authService.verifyToken(token);
  } else {
    // Local dev fallback: find first user or create default dev user
    const [firstUser] = await db.select().from(schema.users).limit(1);
    if (firstUser) {
      principal = {
        tenantId: firstUser.tenantId,
        userId: firstUser.id,
        email: firstUser.email,
        displayName: firstUser.displayName,
        scopes: ALL_SCOPES,
        role: firstUser.role as any,
      };
    } else {
      const created = await authService.createTenantAndOwner({
        tenantName: "Default Organization",
        slug: "default",
        ownerEmail: "owner@mailwarden.local",
        ownerDisplayName: "Mailwarden Owner",
      });
      principal = {
        tenantId: created.tenantId,
        userId: created.userId,
        email: "owner@mailwarden.local",
        displayName: "Mailwarden Owner",
        scopes: ALL_SCOPES,
        role: "owner",
      };
    }
  }

  const server = createMcpServer(principal);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error in Mailwarden MCP Stdio server:", err);
  process.exit(1);
});
