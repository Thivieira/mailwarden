import { Elysia, t } from "elysia";
import { authService } from "../../services/auth";
import { createMcpServer, ALL_MCP_TOOLS } from "../../mcp/server";
import type { AuthPrincipal } from "../../types/auth";
import { config } from "../../config";
import { nanoid } from "nanoid";

// Active sessions map for SSE transports
const activeSessions = new Map<string, { principal: AuthPrincipal; server: ReturnType<typeof createMcpServer> }>();

async function handleJsonRpcRequest(principal: AuthPrincipal, body: any) {
  const { method, params, id } = body as any;

  if (method === "tools/list") {
    const tools = ALL_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        typeof tool.parameters?.toJSONSchema === "function"
          ? tool.parameters.toJSONSchema()
          : { type: "object", properties: {} },
    }));
    return {
      jsonrpc: "2.0",
      result: { tools },
      id,
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = ALL_MCP_TOOLS.find((t) => t.name === toolName);

    if (!tool) {
      return {
        jsonrpc: "2.0",
        error: { code: -32601, message: `Tool '${toolName}' not found` },
        id,
      };
    }

    const parseResult = tool.parameters.safeParse(toolArgs);
    if (!parseResult.success) {
      return {
        jsonrpc: "2.0",
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Validation error: ${parseResult.error.issues.map((i: any) => i.message).join(", ")}`,
            },
          ],
        },
        id,
      };
    }

    try {
      const result = await tool.handler(principal, parseResult.data);
      return {
        jsonrpc: "2.0",
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
        id,
      };
    } catch (err: any) {
      return {
        jsonrpc: "2.0",
        result: {
          isError: true,
          content: [{ type: "text", text: `[${err.name || "ERROR"}] ${err.message}` }],
        },
        id,
      };
    }
  }

  return {
    jsonrpc: "2.0",
    error: { code: -32601, message: `Unsupported method: ${method}` },
    id,
  };
}

export const mcpRoutes = new Elysia({ aot: false })
  // Standard Bearer Header RPC
  .post(
    "/mcp/rpc",
    async ({ headers, body }) => {
      const authHeader = headers["authorization"];
      if (!authHeader?.startsWith("Bearer ")) {
        return {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Authorization header (Bearer token) required" },
          id: (body as any)?.id || null,
        };
      }

      let principal: AuthPrincipal;
      try {
        principal = await authService.verifyToken(authHeader.slice(7));
      } catch (err: any) {
        return {
          jsonrpc: "2.0",
          error: { code: -32000, message: err.message },
          id: (body as any)?.id || null,
        };
      }

      return handleJsonRpcRequest(principal, body);
    },
    {
      body: t.Object({
        jsonrpc: t.Optional(t.String()),
        method: t.String(),
        params: t.Optional(t.Any()),
        id: t.Optional(t.Any()),
      }),
    }
  )

  // SSE Stream: Authenticates via Authorization: Bearer header OR single-use ephemeral stream ticket (?ticket=st_...)
  .get("/mcp/sse", async ({ headers, query, set }) => {
    let principal: AuthPrincipal;

    try {
      const authHeader = headers["authorization"];
      if (authHeader?.startsWith("Bearer ")) {
        principal = await authService.verifyToken(authHeader.slice(7));
      } else if (query.ticket) {
        principal = await authService.consumeEphemeralStreamTicket(query.ticket);
      } else {
        set.status = 401;
        set.headers["WWW-Authenticate"] = `Bearer realm="mailwarden", resource="${config.APP_BASE_URL}", error="invalid_token", error_description="Bearer token or ?ticket is required"`;
        return "Unauthorized: Bearer token in Authorization header or valid ?ticket is required";
      }
    } catch (err: any) {
      set.status = 401;
      set.headers["WWW-Authenticate"] = `Bearer realm="mailwarden", resource="${config.APP_BASE_URL}", error="invalid_token", error_description="${err.message}"`;
      return `Unauthorized: ${err.message}`;
    }

    const sessionId = nanoid();
    const server = createMcpServer(principal);
    activeSessions.set(sessionId, { principal, server });

    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";

    const stream = new ReadableStream({
      start(controller) {
        const endpointEvent = `event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`;
        controller.enqueue(new TextEncoder().encode(endpointEvent));
      },
      cancel() {
        activeSessions.delete(sessionId);
      },
    });

    return stream;
  });
