/**
 * Renders each browser-facing page to `.impeccable/review/` with realistic data, so the
 * design can be inspected without a database, a registered OAuth client, or a live
 * provider callback. Not shipped to the Worker.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderToString } from "solid-js/web";
import { document_ } from "./document";
import { ALL_SCOPES } from "../types/auth";
import { AuthorizePage, CallbackPage, DeniedPage } from "./pages.gen.js";

const OUT = join(process.cwd(), ".impeccable", "review");
const HOST = "mailwarden.corenet.workers.dev";

const params = {
  client_id: "mw_client_8Kd2Rn4pQvXwLm7T",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "st_9f3ba71c04e8",
  scope: ALL_SCOPES.join(" "),
  resource: `https://${HOST}`,
};

async function write(name: string, title: string, view: () => unknown) {
  await Bun.write(join(OUT, `${name}.html`), document_(title, renderToString(view as () => string)));
}

await mkdir(OUT, { recursive: true });

await write("page-authorize", "Authorize Mailwarden", () =>
  AuthorizePage({
    host: HOST,
    clientName: "Claude",
    scopes: ALL_SCOPES,
    mutationsEnabled: false,
    params,
  })
);

await write("page-denied", "Authorization denied", () =>
  DeniedPage({ host: HOST })
);

await write("page-callback", "Gmail connected", () =>
  CallbackPage({
    host: HOST,
    granted: true,
    headline: "Gmail connected",
    detail:
      "This account is now readable by your vault. Mailwarden holds the provider credentials; your AI client never receives them.",
    facts: [
      { term: "Account", value: "thiago@example.com" },
      { term: "First sync", value: "50 recent messages synchronized." },
    ],
  })
);

await write("page-callback-failed", "Gmail connection failed", () =>
  CallbackPage({
    host: HOST,
    granted: false,
    headline: "Gmail connection failed",
    detail: "Missing Google OAuth code/state",
    facts: [],
  })
);

console.log(`preview: 4 pages -> ${OUT}`);
