import { describe, expect, it } from "bun:test";
import { MCP_UI_APPS, UI_RESOURCE_MIME, toolUiMeta, uiResourceDescriptors } from "../src/mcp/ui/registry";
import { APP_HTML } from "../src/mcp/ui/apps.gen";
import { ALL_MCP_TOOLS } from "../src/mcp/server";

/**
 * MCP Apps wire-shape guards.
 *
 * The exact strings here were read off `@modelcontextprotocol/ext-apps@1.7.5` by calling
 * `registerAppTool` through an in-memory client, not transcribed from prose. They are easy
 * to get subtly wrong and the failure is silent: a host that does not recognise the MIME
 * type or the `_meta` key simply renders text and never tells you why.
 */
describe("MCP Apps registry", () => {
  it("uses the exact MCP App MIME type", () => {
    expect(UI_RESOURCE_MIME).toBe("text/html;profile=mcp-app");
    for (const r of uiResourceDescriptors()) expect(r.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("every app points at a ui:// URI and a tool that actually exists", () => {
    const toolNames = new Set(ALL_MCP_TOOLS.map((t) => t.name));
    for (const app of MCP_UI_APPS) {
      expect(app.uri.startsWith("ui://")).toBe(true);
      expect(toolNames).toContain(app.tool);
    }
  });

  it("tool _meta carries both the nested object and the flat alias", () => {
    const meta = toolUiMeta("open_settings") as any;
    expect(meta).toBeDefined();
    expect(meta.ui.resourceUri).toBe("ui://mailwarden/settings.html");
    // The SDK emits both; hosts may read either.
    expect(meta["ui/resourceUri"]).toBe("ui://mailwarden/settings.html");
    // ChatGPT's legacy alias for the same thing.
    expect(meta["openai/outputTemplate"]).toBe("ui://mailwarden/settings.html");
  });

  it("tools without a UI advertise no _meta at all", () => {
    expect(toolUiMeta("send_draft")).toBeUndefined();
    expect(toolUiMeta("search_mail")).toBeUndefined();
    expect(toolUiMeta("nope")).toBeUndefined();
  });

  it("every registered app has a built, self-contained document", () => {
    for (const app of MCP_UI_APPS) {
      const html = APP_HTML[app.id];
      expect(html).toBeDefined();
      expect(html!.startsWith("<!doctype html>")).toBe(true);
      // Self-contained: the sandbox blocks external fetches, so nothing may be referenced.
      expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
      expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
      // Carries the shared design tokens rather than its own palette.
      expect(html).toContain("--brass");
      // The bundle must not have broken out of its own script element.
      expect((html!.match(/<\/script>/g) ?? []).length).toBe(1);
    }
  });
});

/**
 * The send-approval flow must never gain a UI or a confirm tool.
 *
 * The safety model rests on a human acting on a browser page carrying a nonce the model
 * never sees. An app could legitimately display a pending draft, but the moment a tool
 * exists that confirms an approval, the model can call it directly and the human is out of
 * the loop. This test is the tripwire for that mistake.
 */
describe("Approval stays out of the UI layer", () => {
  it("no MCP App is bound to an approval or send tool", () => {
    for (const app of MCP_UI_APPS) {
      expect(app.tool).not.toMatch(/approve|approval|confirm|send/i);
    }
  });

  it("no tool exists that could confirm a send approval", () => {
    const confirmers = ALL_MCP_TOOLS.filter((t) => /confirm.*approval|approve.*send|approval.*confirm/i.test(t.name));
    expect(confirmers.map((t) => t.name)).toEqual([]);
  });
});

describe("open_settings works without any UI", () => {
  it("is a normal tool with a schema, so non-UI hosts still function", () => {
    const tool = ALL_MCP_TOOLS.find((t) => t.name === "open_settings");
    expect(tool).toBeDefined();
    expect(typeof tool!.parameters.safeParse).toBe("function");
    expect(tool!.parameters.safeParse({}).success).toBe(true);
  });
});
