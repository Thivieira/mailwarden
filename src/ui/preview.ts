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
import { ApprovalReviewPage } from "./approval.gen.js";

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
      "This account is connected. Mailwarden stores the connection; your AI assistant never sees it.",
    facts: [
      { term: "Account", value: "thiago@example.com" },
      { term: "First sync", value: "50 recent messages synced." },
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

await write("page-approval", "Review outgoing email", () =>
  ApprovalReviewPage({
    host: HOST,
    state: "pending",
    recipients: "Ana Ribeiro <ana@cliente.com.br>, Tom Fisher <tom@fisher.co>",
    subject: "Re: Q3 handover — revised dates",
    body: "Hi Ana,\n\nThanks for the nudge. The revised handover dates work on our side:\n\n  Kickoff    12 September\n  Handover   30 September\n\nI have looped Tom in so he can pick up the billing questions.\n\nBest,\nThiago\n\n--\nThiago Vieira · FoxDev Studio",
    fingerprint: "3f8a1c9d4e7b2058c6f1a3d90b74e28d5c1f6a09b3e847d2a5c90f1b6e3d8a47",
    approvalId: "apr_9Kd2Rn4pQvXw",
    confirmationNonce: "cn_7f3ba71c04e8",
  })
);

console.log(`preview: 5 pages -> ${OUT}`);
