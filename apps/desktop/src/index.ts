import { localBridgeClient } from "./bridge-client";
import { renderDesktopHtml } from "./ui";

const PORT = Number(process.env.DESKTOP_PORT) || 8790;

export function startDesktopApp(port = PORT) {
  const server = Bun.serve({
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
        const state = await localBridgeClient.getStatus();
        return Response.json(state);
      }

      if (url.pathname === "/api/repair" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { action?: any };
        const result = await localBridgeClient.triggerRepair(body.action || "retry_sync");
        return Response.json(result);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return server;
}

if (import.meta.main) {
  const server = startDesktopApp();
  console.log(`[Mailwarden Desktop] Companion running at http://127.0.0.1:${server.port}`);
}
