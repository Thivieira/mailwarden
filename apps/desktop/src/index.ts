/**
 * Mailwarden Desktop companion.
 *
 * A loopback shell over the local Bridge daemon: it renders what the daemon
 * reports and forwards diagnostics and repair requests to it. All interpretation
 * lives in Bridge Core, so the shell has no process management and no health
 * logic of its own.
 */
import { BRIDGE_REPAIR_ACTIONS, type BridgeRepairAction } from "@mailwarden/contracts";
import { localBridgeClient } from "./bridge-client";
import { renderDesktopHtml } from "./ui";

const PORT = Number(process.env.DESKTOP_PORT) || 8790;

export function startDesktopApp(port = PORT) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/status") {
        const state = await localBridgeClient.getStatus();
        return new Response(renderDesktopHtml(state), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/status") {
        return Response.json(await localBridgeClient.getStatus());
      }

      if (url.pathname === "/api/diagnostics") {
        const report = await localBridgeClient.getDiagnostics();
        return Response.json(report ?? { error: "bridge_unreachable" }, { status: report ? 200 : 503 });
      }

      if (url.pathname === "/api/repair" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { action?: string };
        const action = BRIDGE_REPAIR_ACTIONS.find((candidate) => candidate === body.action) as
          | BridgeRepairAction
          | undefined;
        if (!action) return Response.json({ error: "unknown_action" }, { status: 400 });
        return Response.json(await localBridgeClient.repair(action));
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = startDesktopApp();
  console.log(`[Mailwarden Desktop] Companion running at http://127.0.0.1:${server.port}`);
}
