/**
 * MCP Apps registry — which tools render a UI, and what the host is told about it.
 *
 * Spec: https://modelcontextprotocol.io/extensions/apps/overview
 * The wire shape here was verified against `@modelcontextprotocol/ext-apps@1.7.5` by
 * calling `registerAppTool` through an in-memory client and reading what it emits, rather
 * than transcribed from prose. Two facts that are easy to get wrong:
 *
 *   - The MIME type is `text/html;profile=mcp-app`, not `text/html`.
 *   - Tool `_meta` carries BOTH the nested `ui: { resourceUri }` object and a flat
 *     `"ui/resourceUri"` key. The SDK emits both, so hosts may read either.
 *
 * ChatGPT reads the same `_meta.ui.resourceUri` but also accepts the legacy
 * `openai/outputTemplate` alias, so we emit that too and cost ourselves nothing.
 */

/** The MIME type that marks a resource as an MCP App. Exact string matters. */
export const UI_RESOURCE_MIME = "text/html;profile=mcp-app";

export interface McpUiApp {
  /** Short id; also the build key and the `.gen.ts` lookup key. */
  id: string;
  /** The `ui://` resource URI. Path structure is arbitrary; keep it stable once shipped. */
  uri: string;
  title: string;
  description: string;
  /** The tool whose result renders this UI. One tool, one app. */
  tool: string;
  /** Shown by the host while the tool runs and after it returns. */
  invoking: string;
  invoked: string;
  preferredSize?: { width?: number; height?: number; maxWidth?: number; maxHeight?: number };
  /**
   * Deny-by-default. Only list what the app actually needs. The font is served from our own
   * origin, so that origin is the only resource domain any app here requires.
   */
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[] };
}

/**
 * Adding an app is: one entry here, one `<id>.client.ts` under `apps/`, and a tool whose
 * `name` matches `tool`. `build.ts` bundles every entry; `apps.gen.ts` is generated.
 *
 * NOTE ON SEND APPROVAL — deliberately absent, and it must stay absent.
 * The safety model rests on a human acting on a browser page carrying a nonce the model
 * never sees. An MCP App could legitimately *display* a pending draft, but the moment a
 * tool exists that confirms an approval, the model can call that tool directly and the
 * human is out of the loop. Approval stays in the browser. Show it, link to it, never
 * confirm it from here.
 */
export const MCP_UI_APPS: McpUiApp[] = [
  {
    id: "settings",
    uri: "ui://mailwarden/settings.html",
    title: "Mailwarden settings",
    description: "Your email rules, the active preset, and whether changes are being applied for real.",
    tool: "open_settings",
    invoking: "Opening your settings",
    invoked: "Settings",
    preferredSize: { width: 640, maxHeight: 720 },
  },
];

export const UI_APP_BY_TOOL = new Map(MCP_UI_APPS.map((a) => [a.tool, a]));
export const UI_APP_BY_URI = new Map(MCP_UI_APPS.map((a) => [a.uri, a]));

/**
 * The `_meta` block a tool advertises so a host knows it renders a UI. Returns undefined
 * for the great majority of tools, which have no UI and must keep working without one.
 */
export function toolUiMeta(toolName: string): Record<string, unknown> | undefined {
  const app = UI_APP_BY_TOOL.get(toolName);
  if (!app) return undefined;

  return {
    ui: {
      resourceUri: app.uri,
      ...(app.csp ? { csp: app.csp } : {}),
      ...(app.preferredSize ? { preferredSize: app.preferredSize } : {}),
    },
    // The SDK emits this flat alias alongside the nested object; hosts may read either.
    "ui/resourceUri": app.uri,
    // ChatGPT compatibility.
    "openai/outputTemplate": app.uri,
    "openai/toolInvocation/invoking": app.invoking,
    "openai/toolInvocation/invoked": app.invoked,
  };
}

/** The `resources/list` entry for each app. */
export function uiResourceDescriptors() {
  return MCP_UI_APPS.map((app) => ({
    uri: app.uri,
    name: app.title,
    description: app.description,
    mimeType: UI_RESOURCE_MIME,
    ...(app.csp ? { _meta: { ui: { csp: app.csp } } } : {}),
  }));
}
