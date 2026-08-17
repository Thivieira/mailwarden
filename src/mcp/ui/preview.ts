/**
 * A minimal MCP Apps host, for developing the UIs without connecting to Claude.
 *
 * It implements just enough of the bridge to make an app run: the `ui/initialize`
 * handshake, the `ui/notifications/tool-result` push, and `tools/call` proxying against
 * canned fixtures. Not shipped to the Worker.
 *
 *   bun run src/mcp/ui/preview.ts     -> http://localhost:8795
 *
 * The protocol version and method names are the ones @modelcontextprotocol/ext-apps sends;
 * if an app suddenly stops loading here, check those first.
 */
import { APP_HTML } from "./apps.gen";
import { MCP_UI_APPS } from "./registry";

const PROTOCOL_VERSION = "2026-01-26";

/** Stand-in tool results, so the apps have something real-shaped to render. */
const FIXTURES: Record<string, unknown> = {
  open_settings: {
    activePreset: "balanced",
    dryRunEnabled: true,
    ruleCount: 3,
    rules: [
      { id: "pol_1", name: "Archive obvious junk", scope: "classification", action: "archive", destination: null, enabled: true },
      { id: "pol_2", name: "Keep anything from Ana in the inbox", scope: "sender", action: "leave", destination: null, enabled: true },
      { id: "pol_3", name: "Prioritise client mail", scope: "organization", action: "prioritize", destination: null, enabled: true },
    ],
  },
  reset_mail_policies: { success: true },
  remove_mail_policy: { success: true },
};

const host = (appId: string, tool: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MCP App preview — ${appId}</title>
<style>
  body { margin:0; font:14px ui-sans-serif,system-ui; background:#0f1115; color:#e6e6e6; display:flex; flex-direction:column; height:100vh; }
  header { padding:.6rem 1rem; border-bottom:1px solid #262b33; display:flex; gap:1rem; align-items:center; }
  header b { font-weight:600; }
  header a { color:#8fa9ce; }
  #log { font-family:ui-monospace,monospace; font-size:11px; color:#8b95a3; max-height:9rem; overflow:auto; padding:.5rem 1rem; border-top:1px solid #262b33; white-space:pre-wrap; }
  iframe { flex:1; border:0; width:100%; background:#fff; }
</style></head>
<body>
  <header><b>mock host</b> <span>${appId}</span> ${MCP_UI_APPS.map((a) => `<a href="/?app=${a.id}">${a.id}</a>`).join(" ")}</header>
  <!-- allow-same-origin is here so the harness can inspect the app while developing.
       A real host does NOT grant it; do not treat this frame as a fidelity test of the
       sandbox, only of the bridge and the rendering. -->
  <iframe id="frame" sandbox="allow-scripts allow-same-origin"></iframe>
  <div id="log"></div>
<script type="module">
const APP_ID = ${JSON.stringify(appId)};
const TOOL = ${JSON.stringify(tool)};
const frame = document.getElementById("frame");
const logEl = document.getElementById("log");
const log = (d, m) => { logEl.textContent += \`\${d} \${m}\\n\`; logEl.scrollTop = logEl.scrollHeight; };

const html = await (await fetch("/app/" + APP_ID)).text();
frame.srcdoc = html;

const send = (msg) => frame.contentWindow.postMessage(msg, "*");

window.addEventListener("message", async (e) => {
  if (e.source !== frame.contentWindow) return;
  const msg = e.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  log("→", msg.method ?? ("result#" + msg.id));

  if (msg.method === "ui/initialize") {
    // Shape per the ext-apps InitializeResult schema: all four fields are required, and
    // omitting hostCapabilities/hostContext fails validation inside the app with a
    // ZodError that never surfaces to the host.
    send({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)},
      hostInfo: { name: "mailwarden-preview", version: "1.0.0" },
      hostCapabilities: {},
      hostContext: {},
    }});
    // Push the initial tool result the way a real host does after the tool runs.
    setTimeout(() => {
      const payload = { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {
        content: [{ type: "text", text: JSON.stringify(FIXTURES[TOOL] ?? {}) }],
        structuredContent: FIXTURES[TOOL] ?? {},
      }};
      log("←", "ui/notifications/tool-result");
      send(payload);
    }, 60);
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    log("  ", "tools/call " + name + " " + JSON.stringify(msg.params?.arguments ?? {}));
    const data = FIXTURES[name] ?? { ok: true };
    send({ jsonrpc: "2.0", id: msg.id, result: {
      content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data,
    }});
    return;
  }

  // Everything else (ui/update-model-context, ui/notifications/*, sizing) gets an empty ok.
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});

const FIXTURES = ${JSON.stringify(FIXTURES)};
</script></body></html>`;

const server = Bun.serve({
  port: 8795,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/app/")) {
      const id = url.pathname.slice(5);
      const html = APP_HTML[id];
      return html
        ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
        : new Response("unknown app", { status: 404 });
    }
    const id = url.searchParams.get("app") ?? MCP_UI_APPS[0]!.id;
    const app = MCP_UI_APPS.find((a) => a.id === id);
    if (!app) return new Response("unknown app", { status: 404 });
    return new Response(host(app.id, app.tool), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`mcp app preview: http://localhost:${server.port}`);
