/**
 * Mailwarden Proton Gateway.
 *
 * Extracted from `src/services/proton-gateway.ts` with its behaviour preserved:
 * the same `/v1` surface, the same normalized message shape, and the same
 * per-request Proton account selection that lets one Bridge host serve several
 * logged-in Proton accounts.
 *
 * What changed is the hardening around it — per-device authentication with
 * replay protection, request size and rate limits, validated caller context,
 * honest health, connection timeouts, generic error bodies, and logs that can
 * never contain a Bridge password.
 */
import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { nanoid } from "nanoid";
import { createLogger, type BridgeLogger } from "./log";
import {
  GatewayRequestError,
  NonceCache,
  RateLimiter,
  readCallContext,
  verifyGatewayRequest,
  type GatewayAuthSecrets,
  type GatewayCallContext,
} from "./gateway-auth";
import { probeTcp } from "./system";

export interface GatewayProtonSettings {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Optional host-wide fallback when Cloud does not send per-account credentials. */
  username?: string;
  password?: string;
}

export interface GatewayOptions {
  host?: string;
  port: number;
  proton: GatewayProtonSettings;
  /** Resolved per request so a rotated device credential takes effect immediately. */
  secrets: () => Promise<GatewayAuthSecrets> | GatewayAuthSecrets;
  maxRequestBytes?: number;
  requestsPerMinute?: number;
  logger?: BridgeLogger;
  /** Test seams. */
  imapClientFactory?: (settings: ImapClientSettings) => ImapClientLike;
  smtpTransportFactory?: (settings: SmtpSettings) => SmtpTransportLike;
  probe?: (host: string, port: number, timeoutMs?: number) => Promise<boolean>;
  /** Notified after every account-scoped request so health can report real usage. */
  onAccountActivity?: (accountId: string, ok: boolean) => void;
}

export interface ImapClientSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface ImapClientLike {
  connect(): Promise<unknown>;
  logout(): Promise<unknown>;
  mailboxOpen(name: string): Promise<{ exists?: number }>;
  fetch(range: string, options: Record<string, unknown>): AsyncIterable<any>;
  fetchOne(range: string, options: Record<string, unknown>, extra?: Record<string, unknown>): Promise<any>;
  messageFlagsAdd(range: string, flags: string[], options?: Record<string, unknown>): Promise<unknown>;
  messageFlagsRemove(range: string, flags: string[], options?: Record<string, unknown>): Promise<unknown>;
  messageMove(range: string, target: string, options?: Record<string, unknown>): Promise<unknown>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface SmtpTransportLike {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Proton Bridge presents a self-signed certificate on loopback, which is exactly
 * why disabling verification is acceptable there and nowhere else. A "Bridge"
 * reachable over the network is not a Proton Bridge we can authenticate, so the
 * gateway refuses instead of silently accepting any certificate.
 */
export function tlsOptionsFor(host: string): { rejectUnauthorized: boolean; servername: string } {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Proton Bridge host must be loopback, got ${host}`);
  }
  // `servername` must be present and must not be an IP: Node rejects an IP as
  // SNI, and without it the STARTTLS handshake fails with "servername argument
  // must be an string". Verification is off regardless — Proton Bridge presents
  // a self-signed certificate on loopback — so the name is only there to satisfy
  // the TLS layer.
  return { rejectUnauthorized: false, servername: "localhost" };
}

function defaultImapFactory(settings: ImapClientSettings): ImapClientLike {
  return new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: false,
    doSTARTTLS: true,
    auth: { user: settings.user, pass: settings.pass },
    tls: tlsOptionsFor(settings.host),
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
    logger: false,
  }) as unknown as ImapClientLike;
}

function defaultSmtpFactory(settings: SmtpSettings): SmtpTransportLike {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: false,
    auth: { user: settings.user, pass: settings.pass },
    tls: tlsOptionsFor(settings.host),
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  }) as unknown as SmtpTransportLike;
}

function mailAddresses(value: any): Array<{ name?: string; address: string }> {
  if (!value?.value || !Array.isArray(value.value)) return [];
  return value.value
    .filter((entry: any) => entry?.address)
    .map((entry: any) => ({ name: entry.name || undefined, address: String(entry.address).toLowerCase() }));
}

function headerRecord(headers: Map<any, any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (value == null) continue;
    result[String(key).toLowerCase()] = typeof value === "string" ? value : String(value);
  }
  return result;
}

export async function normalizeImapMessage(
  message: any,
  context: { tenantId: string; userId: string; accountId: string }
): Promise<Record<string, unknown>> {
  const parsed = await simpleParser(message.source);
  const from = mailAddresses(parsed.from)[0] || { address: "unknown@proton.local" };
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
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
    attachments: (parsed.attachments || []).map((attachment: any, index: number) => ({
      id: `proton_${message.uid}_att_${index}`,
      filename: attachment.filename || `attachment-${index + 1}`,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

function parseJsonBody(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function formatAddressList(list: any): string | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list
    .filter((entry: any) => entry?.address)
    .map((entry: any) => (entry.name ? `"${String(entry.name).replace(/"/g, "")}" <${entry.address}>` : entry.address))
    .join(", ");
}

export function createGatewayApp(options: GatewayOptions) {
  const log = options.logger ?? createLogger();
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const limiter = new RateLimiter(options.requestsPerMinute ?? 600);
  const nonces = new NonceCache();
  const imapFactory = options.imapClientFactory ?? defaultImapFactory;
  const smtpFactory = options.smtpTransportFactory ?? defaultSmtpFactory;
  const probe = options.probe ?? probeTcp;

  function credentialsFor(context: GatewayCallContext): { user: string; pass: string } {
    const user = context.username || options.proton.username;
    const pass = context.password || options.proton.password;
    if (!user || !pass) {
      throw new GatewayRequestError("No Proton Bridge credentials for this account");
    }
    return { user, pass };
  }

  function imapFor(context: GatewayCallContext): ImapClientLike {
    const { user, pass } = credentialsFor(context);
    // ponytail: one IMAP connection per request. Add pooling keyed by account
    // only if measured latency justifies the extra lifecycle complexity.
    return imapFactory({ host: options.proton.imapHost, port: options.proton.imapPort, user, pass });
  }

  async function recentMessages(context: GatewayCallContext, limit = 50): Promise<Array<Record<string, unknown>>> {
    const client = imapFor(context);
    await client.connect();
    try {
      const mailbox = await client.mailboxOpen("INBOX");
      const total = mailbox.exists || 0;
      if (!total) return [];
      const count = Math.min(Math.max(limit, 1), 100);
      const start = Math.max(1, total - count + 1);
      const messages: Array<Record<string, unknown>> = [];
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

  const app = new Hono<{ Variables: { rawBody: string; context: GatewayCallContext } }>()
    .basePath("/v1")
    .use("*", async (c, next) => {
      if (!limiter.allow()) return c.json({ error: "Too many requests" }, 429);

      const declared = Number(c.req.header("content-length") || 0);
      if (Number.isFinite(declared) && declared > maxRequestBytes) {
        return c.json({ error: "Request too large" }, 413);
      }
      const rawBody = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
      if (Buffer.byteLength(rawBody) > maxRequestBytes) {
        return c.json({ error: "Request too large" }, 413);
      }
      c.set("rawBody", rawBody);

      const secrets = await options.secrets();
      const result = verifyGatewayRequest(
        { method: c.req.method, path: new URL(c.req.url).pathname, headers: c.req.raw.headers, rawBody },
        secrets,
        nonces
      );
      if (!result.ok) {
        log("warn", "Rejected gateway request", { reason: result.reason, path: new URL(c.req.url).pathname });
        return c.json({ error: "Unauthorized" }, 401);
      }
      if (result.mode === "legacy-shared-key") {
        log("warn", "Gateway request authenticated with the deployment-wide legacy key", {
          path: new URL(c.req.url).pathname,
        });
      }

      if (c.req.path.endsWith("/health")) return next();
      try {
        c.set("context", readCallContext(c.req.raw.headers));
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Invalid request context" }, 400);
      }
      try {
        await next();
      } finally {
        // Recorded even when the route threw, so a failing account shows up as
        // failing instead of simply disappearing from the health summary.
        options.onAccountActivity?.(c.get("context").accountId, (c.res?.status ?? 500) < 400);
      }
    })
    .onError((error, c) => {
      // Callers get a stable, non-revealing message; the detail stays local.
      log("error", "Gateway request failed", { message: error.message, path: new URL(c.req.url).pathname });
      if (error instanceof GatewayRequestError) return c.json({ error: error.message }, 400);
      return c.json({ error: "Proton gateway request failed" }, 502);
    })
    .get("/health", async (c) => {
      const imapReachable = await probe(options.proton.imapHost, options.proton.imapPort, 2_000);
      const smtpReachable = await probe(options.proton.smtpHost, options.proton.smtpPort, 2_000);
      return c.json(
        {
          status: imapReachable && smtpReachable ? "healthy" : imapReachable ? "degraded" : "unhealthy",
          protocol: 1,
          bridge: {
            host: options.proton.imapHost,
            imapPort: options.proton.imapPort,
            smtpPort: options.proton.smtpPort,
            imapReachable,
            smtpReachable,
          },
        },
        imapReachable ? 200 : 503
      );
    })
    .post("/search", async (c) => {
      const context = c.get("context");
      const body = parseJsonBody(c.get("rawBody"));
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
      const query = String(body.query || "").trim().toLowerCase();
      let messages = await recentMessages(context, limit);
      if (query) {
        messages = messages.filter((message: any) =>
          String(message.subject).toLowerCase().includes(query) ||
          String(message.textBody).toLowerCase().includes(query) ||
          String(message.from?.address ?? "").toLowerCase().includes(query)
        );
      }
      return c.json({ messages, totalEstimated: messages.length });
    })
    .get("/messages/:id", async (c) => {
      const context = c.get("context");
      const uid = Number(c.req.param("id"));
      if (!Number.isInteger(uid) || uid <= 0) return c.json({ error: "Invalid Proton message UID" }, 400);

      const client = imapFor(context);
      await client.connect();
      try {
        await client.mailboxOpen("INBOX");
        const message = await client.fetchOne(
          String(uid),
          { uid: true, source: true, flags: true, internalDate: true },
          { uid: true }
        );
        if (!message) return c.json({ error: "Message not found" }, 404);
        return c.json(await normalizeImapMessage(message, context));
      } finally {
        await client.logout().catch(() => undefined);
      }
    })
    .get("/threads/:threadId", async (c) => {
      const context = c.get("context");
      const messages = await recentMessages(context, 100);
      return c.json(messages.filter((message: any) => message.providerThreadId === c.req.param("threadId")));
    })
    .post("/messages/:id/mutate", async (c) => {
      const context = c.get("context");
      const uid = Number(c.req.param("id"));
      if (!Number.isInteger(uid) || uid <= 0) return c.json({ error: "Invalid Proton message UID" }, 400);
      const action = String(parseJsonBody(c.get("rawBody")).action || "");
      const client = imapFor(context);
      await client.connect();
      try {
        await client.mailboxOpen("INBOX");
        if (action === "mark_read") await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        else if (action === "mark_unread") await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
        else if (action === "archive") await client.messageMove(String(uid), "Archive", { uid: true });
        else return c.json({ error: "Unsupported Proton mutation" }, 400);
        return c.json({ success: true });
      } finally {
        await client.logout().catch(() => undefined);
      }
    })
    .post("/drafts", (c) => c.json({ providerDraftId: `proton_draft_${nanoid()}` }))
    .put("/drafts/:id", (c) => c.json({ providerDraftId: c.req.param("id") }))
    .post("/send", async (c) => {
      const context = c.get("context");
      const draft = parseJsonBody(c.get("rawBody"));
      const { user, pass } = credentialsFor(context);

      const transporter = smtpFactory({
        host: options.proton.smtpHost,
        port: options.proton.smtpPort,
        user,
        pass,
      });

      const to = formatAddressList(draft.to);
      if (!to) return c.json({ error: "A recipient is required" }, 400);

      const info = await transporter.sendMail({
        from: draft.from?.address || user,
        to,
        cc: formatAddressList(draft.cc),
        bcc: formatAddressList(draft.bcc),
        subject: draft.subject,
        text: draft.textBody,
        html: draft.htmlBody || undefined,
        inReplyTo: draft.replyToMessageId || undefined,
      });

      log("info", "Message sent through Proton Bridge SMTP", { accountId: context.accountId });
      return c.json({
        success: true,
        providerMessageId: info.messageId || `proton_sent_${Date.now()}`,
        draftId: draft.id,
        sentAt: new Date().toISOString(),
      });
    });

  return app;
}

export interface RunningGateway {
  port: number;
  stop(): Promise<void>;
}

export function startGateway(options: GatewayOptions): RunningGateway {
  const app = createGatewayApp(options);
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`The gateway binds to loopback only; the tunnel publishes it. Got ${host}`);
  }
  const server = Bun.serve({ port: options.port, hostname: host, fetch: app.fetch });
  return {
    port: server.port ?? options.port ?? 8080,
    async stop() {
      await server.stop(true);
    },
  };
}
