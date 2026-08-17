import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger";
import { readBody } from "../http/context";

const GATEWAY_API_KEY = process.env.PROTON_GATEWAY_API_KEY;
const BRIDGE_IMAP_PORT = parseInt(process.env.PROTON_BRIDGE_IMAP_PORT || "1143", 10);
const BRIDGE_SMTP_PORT = parseInt(process.env.PROTON_BRIDGE_SMTP_PORT || "1025", 10);
const BRIDGE_HOST = process.env.PROTON_BRIDGE_HOST || "127.0.0.1";
const BRIDGE_USERNAME = process.env.PROTON_BRIDGE_USERNAME;
const BRIDGE_PASSWORD = process.env.PROTON_BRIDGE_PASSWORD;

function assertConfigured() {
  if (!GATEWAY_API_KEY || !BRIDGE_USERNAME || !BRIDGE_PASSWORD) {
    throw new Error("Set PROTON_GATEWAY_API_KEY, PROTON_BRIDGE_USERNAME and PROTON_BRIDGE_PASSWORD before starting the Proton gateway");
  }
}

function makeImapClient() {
  assertConfigured();
  return new ImapFlow({
    host: BRIDGE_HOST,
    port: BRIDGE_IMAP_PORT,
    secure: false,
    doSTARTTLS: true,
    auth: { user: BRIDGE_USERNAME!, pass: BRIDGE_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
}

function mailAddresses(value: any): Array<{ name?: string; address: string }> {
  if (!value?.value || !Array.isArray(value.value)) return [];
  return value.value
    .filter((x: any) => x?.address)
    .map((x: any) => ({ name: x.name || undefined, address: String(x.address).toLowerCase() }));
}

function headerRecord(headers: Map<any, any>) {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (value == null) continue;
    result[String(key).toLowerCase()] = typeof value === "string" ? value : String(value);
  }
  return result;
}

async function normalizeImapMessage(message: any, context: { tenantId: string; userId: string; accountId: string }) {
  const parsed = await simpleParser(message.source);
  const from = mailAddresses(parsed.from)[0] || { address: "unknown@proton.local" };
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const threadId = parsed.inReplyTo || references[0] || parsed.messageId || `proton-thread-${message.uid}`;
  const now = new Date();
  const html = typeof parsed.html === "string" ? parsed.html : undefined;

  return {
    id: `proton_${message.uid}`,
    tenantId: context.tenantId,
    userId: context.userId,
    accountId: context.accountId,
    provider: "proton",
    providerMessageId: String(message.uid),
    providerThreadId: String(threadId),
    from,
    to: mailAddresses(parsed.to),
    cc: mailAddresses(parsed.cc),
    bcc: mailAddresses(parsed.bcc),
    replyTo: mailAddresses(parsed.replyTo),
    subject: parsed.subject || "(No Subject)",
    textBody: parsed.text || "",
    htmlBody: html,
    receivedAt: message.internalDate || parsed.date || now,
    sentAt: parsed.date || undefined,
    headers: headerRecord(parsed.headers),
    flags: {
      unread: !message.flags?.has("\\Seen"),
      starred: Boolean(message.flags?.has("\\Flagged")),
      draft: Boolean(message.flags?.has("\\Draft")),
      archived: false,
      bulk: Boolean(parsed.headers.get("list-id") || parsed.headers.get("list-unsubscribe")),
      automated: /no-?reply|mailer-daemon/i.test(from.address),
      hasListUnsubscribe: Boolean(parsed.headers.get("list-unsubscribe")),
      transactional: false,
    },
    attachments: (parsed.attachments || []).map((att: any, index: number) => ({
      id: `proton_${message.uid}_att_${index}`,
      filename: att.filename || `attachment-${index + 1}`,
      contentType: att.contentType,
      size: att.size,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

function contextFromHeaders(headers: { get(name: string): string | undefined | null }) {
  const tenantId = headers.get("x-tenant-id");
  const userId = headers.get("x-user-id");
  const accountId = headers.get("x-account-id");
  if (!tenantId || !userId || !accountId) throw new Error("Missing Mailwarden tenant/user/account context headers");
  return { tenantId, userId, accountId };
}

async function recentMessages(context: { tenantId: string; userId: string; accountId: string }, limit = 50) {
  const client = makeImapClient();
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen("INBOX");
    const total = mailbox.exists || 0;
    if (!total) return [];
    const count = Math.min(Math.max(limit, 1), 100);
    const start = Math.max(1, total - count + 1);
    const messages: any[] = [];
    for await (const message of client.fetch(`${start}:*`, {
      uid: true,
      source: true,
      flags: true,
      internalDate: true,
    })) {
      messages.push(await normalizeImapMessage(message, context));
    }
    return messages.reverse();
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export const protonGatewayApp = new Hono()
  .basePath("/v1")
  .use("*", async (c, next) => {
    if (!GATEWAY_API_KEY || c.req.header("authorization") !== `Bearer ${GATEWAY_API_KEY}`) {
      return c.json({ error: "Unauthorized Proton gateway request" }, 401);
    }
    return next();
  })
  .get("/health", async (c) => {
    try {
      const client = makeImapClient();
      await client.connect();
      await client.logout();
      return c.json({ status: "healthy", bridge: { host: BRIDGE_HOST, imapPort: BRIDGE_IMAP_PORT, smtpPort: BRIDGE_SMTP_PORT } });
    } catch (error: any) {
      return c.json({ status: "unhealthy", error: error.message }, 503);
    }
  })
  .post("/search", async (c) => {
    const context = contextFromHeaders(c.req.raw.headers);
    const body = await readBody(c);
    const limit = Math.min(Number(body?.limit || 50), 100);
    const query = String(body?.query || "").trim().toLowerCase();
    let messages = await recentMessages(context, limit);
    if (query) {
      messages = messages.filter((m: any) =>
        m.subject.toLowerCase().includes(query) ||
        m.textBody.toLowerCase().includes(query) ||
        m.from.address.toLowerCase().includes(query)
      );
    }
    return c.json({ messages, totalEstimated: messages.length });
  })
  .get("/messages/:id", async (c) => {
    const context = contextFromHeaders(c.req.raw.headers);
    const uid = Number(c.req.param("id"));
    if (!Number.isFinite(uid)) return c.json({ error: "Invalid Proton message UID" }, 400);

    const client = makeImapClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      const message = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, internalDate: true }, { uid: true });
      if (!message) return c.json({ error: "Message not found" }, 404);
      return c.json(await normalizeImapMessage(message, context));
    } finally {
      await client.logout().catch(() => undefined);
    }
  })
  .get("/threads/:threadId", async (c) => {
    const context = contextFromHeaders(c.req.raw.headers);
    const messages = await recentMessages(context, 100);
    return c.json(messages.filter((m: any) => m.providerThreadId === c.req.param("threadId")));
  })
  .post("/messages/:id/mutate", async (c) => {
    const uid = Number(c.req.param("id"));
    const { action } = await readBody(c);
    const client = makeImapClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      if (action === "mark_read") await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      else if (action === "mark_unread") await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
      else if (action === "archive") await client.messageMove(String(uid), "Archive", { uid: true });
      else throw new Error(`Unsupported Proton mutation: ${action}`);
      return c.json({ success: true });
    } finally {
      await client.logout().catch(() => undefined);
    }
  })
  .post("/drafts", (c) => c.json({ providerDraftId: `proton_draft_${nanoid()}` }))
  .put("/drafts/:id", (c) => c.json({ providerDraftId: c.req.param("id") }))
  .post("/send", async (c) => {
    assertConfigured();
    const draft = await readBody(c);
    const transporter = nodemailer.createTransport({
      host: BRIDGE_HOST,
      port: BRIDGE_SMTP_PORT,
      secure: false,
      auth: { user: BRIDGE_USERNAME!, pass: BRIDGE_PASSWORD! },
      tls: { rejectUnauthorized: false },
    });

    const info = await transporter.sendMail({
      from: draft.from?.address || BRIDGE_USERNAME,
      to: (draft.to || []).map((x: any) => x.name ? `"${x.name}" <${x.address}>` : x.address).join(", "),
      cc: (draft.cc || []).map((x: any) => x.name ? `"${x.name}" <${x.address}>` : x.address).join(", ") || undefined,
      bcc: (draft.bcc || []).map((x: any) => x.name ? `"${x.name}" <${x.address}>` : x.address).join(", ") || undefined,
      subject: draft.subject,
      text: draft.textBody,
      html: draft.htmlBody || undefined,
      inReplyTo: draft.replyToMessageId || undefined,
    });

    logger.info("[PROTON GATEWAY] Message sent through Proton Bridge SMTP", { messageId: info.messageId });
    return c.json({
      success: true,
      providerMessageId: info.messageId || `proton_sent_${Date.now()}`,
      draftId: draft.id,
      sentAt: new Date().toISOString(),
    });
  });

if (import.meta.main) {
  assertConfigured();
  const port = parseInt(process.env.PORT || "8080", 10);
  Bun.serve({ port, hostname: "127.0.0.1", fetch: protonGatewayApp.fetch });
  logger.info(`🛡️ Proton Bridge Gateway running on http://127.0.0.1:${port}`);
}
