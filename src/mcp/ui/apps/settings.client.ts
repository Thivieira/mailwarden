/**
 * The Mailwarden settings app, rendered inside the conversation.
 *
 * This is the surface the product never had: `/api/preferences` and `/api/policies` have
 * always worked, but the only ways to reach them were MCP tool calls or curl. It runs in
 * the host's sandboxed iframe and talks to the server through the MCP Apps bridge.
 *
 * Two rules this file lives by:
 *
 *   1. `open_settings` must stay useful without this UI. A host that cannot render apps
 *      still gets the full settings as structured content, so the model can read and
 *      explain them. This app is an enhancement, never the only path.
 *   2. It calls only tools the model could already call. The app is not a privilege
 *      boundary — the host proxies every `callServerTool` and the same scopes apply. It
 *      must never become the place where a capability is smuggled in.
 *
 * Written against @modelcontextprotocol/ext-apps; bundled into the page by build.ts, so no
 * dependency ships to the Worker.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface PolicyRule {
  id: string;
  name: string;
  scope: string;
  action: string;
  destination?: string | null;
  enabled: boolean;
}

interface SettingsPayload {
  activePreset?: string;
  dryRunEnabled?: boolean;
  ruleCount?: number;
  rules?: PolicyRule[];
  presetDescription?: string;
}

const SEAL =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m7.5 9.5 4.5 3.5 4.5-3.5"/></svg>';

const ICONS: Record<string, string> = {
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  mark_read: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  mark_unread: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
};

const icon = (name: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.bookmark}</svg>`;

/**
 * Everything below is interpolated into innerHTML, and rule names are user-authored, so
 * escape without exception. The browser pages get this free from Solid; here it is manual
 * and therefore easy to forget.
 */
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

/** Raw enum values never reach the screen; the browser pages hold the same rule. */
const ACTION_WORDS: Record<string, string> = {
  archive: "Move out of the inbox",
  mark_read: "Mark as read",
  mark_unread: "Keep unread",
  keep_unread: "Keep unread",
  leave: "Leave it alone",
  label: "Add a label",
  move: "Move to a folder",
  prioritize: "Raise its priority",
  surface: "Bring it to my attention",
};

const SCOPE_WORDS: Record<string, string> = {
  global: "Everything",
  classification: "By kind of mail",
  account: "One account",
  organization: "One organisation",
  project: "One project",
  relationship: "One relationship",
  sender: "One sender",
  domain: "One domain",
  thread: "One conversation",
  message: "One message",
};

const app = new App({ name: "Mailwarden Settings", version: "1.0.0" });
const root = document.getElementById("root")!;

let state: SettingsPayload = {};
let busy = false;

function render() {
  const rules = state.rules ?? [];
  const dry = state.dryRunEnabled === true;

  root.innerHTML = `
    <div class="app-head">
      ${SEAL}
      <h1>Mailwarden</h1>
      <span class="spacer"></span>
      <span class="badge" data-tone="${dry ? "warn" : "live"}">
        ${dry ? "Practice mode" : "Changes are live"}
      </span>
    </div>

    ${
      dry
        ? `<div class="notice">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.info}</svg>
             <span>Your rules are running, but nothing in your mailbox is actually being moved or marked yet. Mailwarden records what it <em>would</em> have done.</span>
           </div>`
        : ""
    }

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Your email rules</h2>
        <p class="card-desc">${
          rules.length === 0
            ? "You have not set any rules yet."
            : `${rules.length} ${rules.length === 1 ? "rule is" : "rules are"} active${
                state.activePreset ? `, from the “${esc(state.activePreset)}” set` : ""
              }.`
        }</p>
      </div>

      ${
        rules.length === 0
          ? `<p class="empty">Ask in the conversation for what you want — “archive newsletters”, “never touch anything from my accountant” — and the rule will appear here.</p>`
          : `<ul class="rows">${rules
              .map(
                (r) => `
              <li>
                <span class="icon">${icon(r.action)}</span>
                <div>
                  <p class="row-title">${esc(r.name || "Untitled rule")}</p>
                  <p class="row-note">${esc(ACTION_WORDS[r.action] ?? r.action)}${
                  r.destination ? ` → ${esc(r.destination)}` : ""
                } · ${esc(SCOPE_WORDS[r.scope] ?? r.scope)}</p>
                </div>
                <button data-variant="danger" data-remove="${esc(r.id)}" ${busy ? "disabled" : ""}>Remove</button>
              </li>`
              )
              .join("")}</ul>`
      }

      <div class="actions">
        <button data-variant="quiet" data-refresh ${busy ? "disabled" : ""}>Refresh</button>
        ${rules.length > 0 ? `<button data-variant="quiet" data-reset ${busy ? "disabled" : ""}>Reset to defaults</button>` : ""}
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("[data-refresh]")?.addEventListener("click", () => run("open_settings", {}));
  root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => run("reset_mail_policies", {}));
  for (const el of root.querySelectorAll<HTMLButtonElement>("[data-remove]")) {
    el.addEventListener("click", () => run("remove_mail_policy", { policyId: el.dataset.remove }));
  }
}

function adopt(result: unknown) {
  // Prefer structuredContent; fall back to parsing the text block, since a host may deliver
  // either depending on how the tool result reached us.
  const r = result as { structuredContent?: SettingsPayload; content?: { type: string; text?: string }[] };
  if (r?.structuredContent && typeof r.structuredContent === "object") return r.structuredContent;
  const text = r?.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as SettingsPayload;
  } catch {
    return null;
  }
}

async function run(tool: string, args: Record<string, unknown>) {
  busy = true;
  render();
  try {
    const result = await app.callServerTool({ name: tool, arguments: args });
    // A mutation returns its own shape, so re-read settings rather than trusting the echo.
    const next = tool === "open_settings" ? adopt(result) : adopt(await app.callServerTool({ name: "open_settings", arguments: {} }));
    if (next) state = next;

    // Let the model see what changed, so the conversation stays in step with the panel.
    if (tool !== "open_settings") {
      await app.updateModelContext({
        content: [
          {
            type: "text",
            text: `The user changed their mail rules in the settings panel. They now have ${
              state.rules?.length ?? 0
            } active rule(s).`,
          },
        ],
      });
    }
  } catch (err) {
    root.innerHTML = `<div class="notice" data-tone="bad">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.alert}</svg>
      <span>That did not go through: ${esc((err as Error)?.message ?? "unknown error")}. Ask in the conversation and it can be done there instead.</span>
    </div>`;
    return;
  } finally {
    busy = false;
  }
  render();
}

app.ontoolresult = (result) => {
  const next = adopt(result);
  if (next) {
    state = next;
    render();
  }
};

app.connect();
