import { Elysia, t } from "elysia";
import { authService } from "../../services/auth";
import { createMcpServer, ALL_MCP_TOOLS, SERVER_INSTRUCTIONS } from "../../mcp/server";
import type { AuthPrincipal } from "../../types/auth";
import { config } from "../../config";
import { nanoid } from "nanoid";

const activeSessions = new Map<string, { principal: AuthPrincipal; server: ReturnType<typeof createMcpServer> }>();

function scopesForTool(name: string): string[] {
  if (name === "get_email_connection_url" || name === "refresh_inboxes") return ["accounts.manage", "mail.read"];
  if (name === "request_send_approval" || name === "send_draft" || name.includes("send")) return ["mail.send", "mail.draft"];
  if (name.startsWith("draft_") || name.includes("draft")) return ["mail.draft", "mail.read"];
  if (name.includes("relationship") || name.includes("sender")) return ["relationships.read"];
  if (name.includes("policy") || name.includes("onboarding")) return ["profile.manage", "mail.read"];
  if (name.includes("account")) return ["accounts.read"];
  return ["mail.read"];
}

async function handleJsonRpcRequest(principal: AuthPrincipal, body: any) {
  const { method, params, id } = body as any;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "mailwarden", version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      },
      id,
    };
  }

  if (method === "ping") return { jsonrpc: "2.0", result: {}, id };
  if (method === "notifications/initialized") return null;

  if (method === "tools/list") {
    const tools = ALL_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        typeof tool.parameters?.toJSONSchema === "function"
          ? tool.parameters.toJSONSchema()
          : { type: "object", properties: {} },
      securitySchemes: [{ type: "oauth2", scopes: scopesForTool(tool.name) }],
    }));
    return { jsonrpc: "2.0", result: { tools }, id };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = ALL_MCP_TOOLS.find((t) => t.name === toolName);

    if (!tool) return { jsonrpc: "2.0", error: { code: -32601, message: `Tool '${toolName}' not found` }, id };

    const parseResult = tool.parameters.safeParse(toolArgs);
    if (!parseResult.success) {
      return {
        jsonrpc: "2.0",
        result: {
          isError: true,
          content: [{ type: "text", text: `Validation error: ${parseResult.error.issues.map((i: any) => i.message).join(", ")}` }],
        },
        id,
      };
    }

    try {
      const result = await tool.handler(principal, parseResult.data);
      return {
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] },
        id,
      };
    } catch (err: any) {
      return {
        jsonrpc: "2.0",
        result: { isError: true, content: [{ type: "text", text: `[${err.name || "ERROR"}] ${err.message}` }] },
        id,
      };
    }
  }

  return { jsonrpc: "2.0", error: { code: -32601, message: `Unsupported method: ${method}` }, id };
}

async function authenticate(headers: Record<string, string | undefined>, queryTicket?: string): Promise<AuthPrincipal> {
  const authHeader = headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authService.verifyToken(authHeader.slice(7));
  if (queryTicket) return authService.consumeEphemeralStreamTicket(queryTicket);
  throw new Error("Bearer token required");
}

export const mcpRoutes = new Elysia({ aot: false })
  .post("/mcp", async ({ headers, body, set }) => {
    let principal: AuthPrincipal;
    try {
      principal = await authenticate(headers as any);
    } catch (err: any) {
      set.status = 401;
      set.headers["WWW-Authenticate"] = `Bearer realm="mailwarden", resource="${config.APP_BASE_URL}", error="invalid_token"`;
      return { jsonrpc: "2.0", error: { code: -32000, message: err.message }, id: (body as any)?.id || null };
    }

    const response = await handleJsonRpcRequest(principal, body);
    if (response === null) {
      set.status = 202;
      return "";
    }
    return response;
  }, { body: t.Any() })
  .post("/mcp/rpc", async ({ headers, body, set }) => {
    let principal: AuthPrincipal;
    try {
      principal = await authenticate(headers as any);
    } catch (err: any) {
      set.status = 401;
      set.headers["WWW-Authenticate"] = `Bearer realm="mailwarden", resource="${config.APP_BASE_URL}", error="invalid_token"`;
      return { jsonrpc: "2.0", error: { code: -32000, message: err.message }, id: (body as any)?.id || null };
    }
    return handleJsonRpcRequest(principal, body);
  }, { body: t.Any() })
  .get("/mcp/sse", async ({ headers, query, set }) => {
    let principal: AuthPrincipal;
    try {
      principal = await authenticate(headers as any, query.ticket);
    } catch (err: any) {
      set.status = 401;
      set.headers["WWW-Authenticate"] = `Bearer realm="mailwarden", resource="${config.APP_BASE_URL}", error="invalid_token"`;
      return `Unauthorized: ${err.message}`;
    }

    const sessionId = nanoid();
    const server = createMcpServer(principal);
    activeSessions.set(sessionId, { principal, server });

    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";

    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`));
      },
      cancel() {
        activeSessions.delete(sessionId);
      },
    });
  });
