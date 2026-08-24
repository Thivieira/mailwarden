import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType, MailAddress, NormalizedAttachment, EmailFlags } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import type {
  MailProvider,
  MailSearchQuery,
  MailSearchResult,
  MailProviderCapabilities,
  NormalizedFolder,
  ConnectionTestResult,
} from "./types";
import type { MailFolderKind } from "@mailwarden/contracts";
import { ProviderError, NotFoundError } from "../utils/errors";
import { sanitizeEmailContent } from "../utils/sanitizer";
import { logger } from "../utils/logger";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "../config";
import { SmtpProvider } from "./smtp";
import { signGatewayRequest } from "@mailwarden/relay";
import { nanoid } from "nanoid";

export interface ImapServerSettings {
  host: string;
  port: number;
  secure?: boolean;
  username: string;
  password?: string;
  authMethod?: "PLAIN" | "LOGIN" | "XOAUTH2";
  rejectUnauthorized?: boolean;
}

export interface SmtpServerSettings {
  host: string;
  port: number;
  secure?: boolean;
  username: string;
  password?: string;
  rejectUnauthorized?: boolean;
}

export interface ImapCredentials {
  emailAddress: string;
  imap: ImapServerSettings;
  smtp?: SmtpServerSettings;
  mode?: "direct" | "gateway";
  gatewayUrl?: string;
  deviceGatewaySecret?: string;
  relayDeviceId?: string;
}

export interface ImapClientLike {
  connect(): Promise<unknown>;
  logout(): Promise<unknown>;
  mailboxOpen(name: string): Promise<{ exists?: number; uidValidity?: bigint | number; uidNext?: number }>;
  list(): Promise<Array<{ path: string; name: string; specialUse?: string; status?: any }>>;
  fetch(range: string, options: Record<string, unknown>): AsyncIterable<any>;
  fetchOne(range: string, options: Record<string, unknown>, extra?: Record<string, unknown>): Promise<any>;
  messageFlagsAdd(range: string, flags: string[], options?: Record<string, unknown>): Promise<unknown>;
  messageFlagsRemove(range: string, flags: string[], options?: Record<string, unknown>): Promise<unknown>;
  messageMove(range: string, target: string, options?: Record<string, unknown>): Promise<unknown>;
}

export function classifyImapFolder(name: string, specialUse?: string): MailFolderKind {
  if (specialUse) {
    const su = specialUse.toLowerCase();
    if (su.includes("\\inbox")) return "inbox";
    if (su.includes("\\sent")) return "sent";
    if (su.includes("\\drafts")) return "drafts";
    if (su.includes("\\trash")) return "trash";
    if (su.includes("\\junk") || su.includes("\\spam")) return "spam";
    if (su.includes("\\archive") || su.includes("\\all")) return "archive";
  }

  const lower = name.toLowerCase().trim();
  if (lower === "inbox" || lower === "caixa de entrada" || lower === "boîte de réception") return "inbox";
  if (
    lower === "sent" ||
    lower === "sent items" ||
    lower === "sent messages" ||
    lower === "itens enviados" ||
    lower === "enviados" ||
    lower === "éléments envoyés"
  ) {
    return "sent";
  }
  if (lower === "drafts" || lower === "draft" || lower === "rascunhos" || lower === "brouillons") return "drafts";
  if (
    lower === "trash" ||
    lower === "deleted" ||
    lower === "deleted items" ||
    lower === "lixeira" ||
    lower === "itens excluídos" ||
    lower === "corbeille"
  ) {
    return "trash";
  }
  if (
    lower === "spam" ||
    lower === "junk" ||
    lower === "junk email" ||
    lower === "lixo eletrônico" ||
    lower === "courrier indésirable"
  ) {
    return "spam";
  }
  if (lower === "archive" || lower === "archives" || lower === "arquivo" || lower === "archiv") return "archive";

  return "custom";
}

function parseMailAddresses(value: any): MailAddress[] {
  if (!value?.value || !Array.isArray(value.value)) return [];
  return value.value
    .filter((entry: any) => entry?.address)
    .map((entry: any) => ({
      name: entry.name || undefined,
      address: String(entry.address).toLowerCase().trim(),
    }));
}

function parseHeaders(headers: Map<any, any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (value == null) continue;
    result[String(key).toLowerCase()] = typeof value === "string" ? value : String(value);
  }
  return result;
}

export async function parseAndNormalizeRawEmail(
  rawSource: Buffer | string,
  uid: number | string,
  context: { tenantId: string; userId: string; accountId: string },
  flags?: Set<string> | string[]
): Promise<NormalizedEmail> {
  const parsed = await simpleParser(rawSource);
  const fromList = parseMailAddresses(parsed.from);
  const from: MailAddress = fromList[0] || { address: "unknown@example.com" };

  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  const threadId = parsed.inReplyTo || references[0] || parsed.messageId || `imap-thread-${uid}`;
  const now = new Date();

  const flagSet = flags instanceof Set ? flags : new Set(Array.isArray(flags) ? flags : []);
  const isUnread = !flagSet.has("\\Seen") && !flagSet.has("\\seen");
  const isStarred = flagSet.has("\\Flagged") || flagSet.has("\\flagged");
  const isDraft = flagSet.has("\\Draft") || flagSet.has("\\draft");

  const sanitized = sanitizeEmailContent(
    parsed.text || "",
    typeof parsed.html === "string" ? parsed.html : undefined
  );

  const headersMap = parseHeaders(parsed.headers);
  const hasListUnsub = Boolean(headersMap["list-unsubscribe"] || parsed.headers.get("list-unsubscribe"));
  const isAuto = /no-?reply|mailer-daemon|notifications?@/i.test(from.address) || Boolean(headersMap["auto-submitted"]);

  const attachments: NormalizedAttachment[] = (parsed.attachments || []).map((att: any, idx: number) => ({
    id: `att_${uid}_${idx}`,
    filename: att.filename || `attachment-${idx + 1}`,
    contentType: att.contentType,
    size: att.size,
  }));

  const receivedDate = parsed.date || now;

  return {
    id: `imap_${uid}`,
    tenantId: context.tenantId,
    userId: context.userId,
    accountId: context.accountId,
    provider: "imap",
    providerMessageId: String(uid),
    providerThreadId: String(threadId),
    from,
    to: parseMailAddresses(parsed.to),
    cc: parseMailAddresses(parsed.cc),
    bcc: parseMailAddresses(parsed.bcc),
    replyTo: parseMailAddresses(parsed.replyTo),
    subject: parsed.subject || "(No Subject)",
    textBody: sanitized.plainText,
    htmlBody: sanitized.safeHtml,
    snippet: sanitized.plainText.slice(0, 200).replace(/\s+/g, " "),
    receivedAt: receivedDate,
    sentAt: parsed.date || undefined,
    headers: headersMap,
    flags: {
      unread: isUnread,
      starred: isStarred,
      draft: isDraft,
      archived: false,
      bulk: sanitized.hasTrackingPixels || hasListUnsub,
      automated: isAuto,
      hasListUnsubscribe: hasListUnsub,
      transactional: false,
    },
    attachments,
    createdAt: now,
    updatedAt: now,
  };
}

export class ImapProvider implements MailProvider {
  readonly provider: ProviderType = "imap";
  private credentials: ImapCredentials;
  private clientFactory?: (settings: ImapServerSettings) => ImapClientLike;

  constructor(
    credentials: ImapCredentials,
    clientFactory?: (settings: ImapServerSettings) => ImapClientLike
  ) {
    this.credentials = credentials;
    this.clientFactory = clientFactory;
  }

  getCapabilities(): MailProviderCapabilities {
    return {
      read: true,
      search: true,
      folders: true,
      labels: false,
      threads: false,
      attachments: true,
      send: Boolean(this.credentials.smtp),
      drafts: true,
      archive: true,
      flags: true,
      incrementalSync: true,
      nativeOAuth: false,
    };
  }

  private createClient(): ImapClientLike {
    if (this.clientFactory) {
      return this.clientFactory(this.credentials.imap);
    }

    const { host, port, username, password, secure, rejectUnauthorized } = this.credentials.imap;
    const isExplicitSecure = secure !== undefined ? secure : port === 993;

    return new ImapFlow({
      host,
      port,
      secure: isExplicitSecure,
      auth: { user: username, pass: password || "" },
      tls: {
        rejectUnauthorized: rejectUnauthorized ?? true,
        servername: host,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      logger: false,
    }) as unknown as ImapClientLike;
  }

  private headers(
    principal: AuthPrincipal,
    accountId: string,
    request: { method: string; path: string; body: string; json?: boolean }
  ): Record<string, string> {
    const base: Record<string, string> = {
      ...(request.json ? { "Content-Type": "application/json" } : {}),
      "X-Tenant-Id": principal.tenantId,
      "X-User-Id": principal.userId,
      "X-Account-Id": accountId,
      ...(this.credentials.imap.username ? { "X-Proton-Username": this.credentials.imap.username } : {}),
      ...(this.credentials.imap.password ? { "X-Proton-Password": this.credentials.imap.password } : {}),
    };

    if (this.credentials.deviceGatewaySecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      return {
        ...base,
        "X-Mailwarden-Signature": signGatewayRequest(this.credentials.deviceGatewaySecret, {
          method: request.method,
          path: request.path,
          timestamp,
          body: request.body,
        }),
        "X-Mailwarden-Timestamp": String(timestamp),
      };
    }

    return base;
  }

  private async callGateway(
    principal: AuthPrincipal,
    accountId: string,
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    const method = init.method || "GET";
    const body = init.body === undefined ? "" : JSON.stringify(init.body);
    const url = new URL(`${this.credentials.gatewayUrl}${path}`);
    try {
      return await fetch(url.toString(), {
        method,
        headers: this.headers(principal, accountId, {
          method,
          path: url.pathname,
          body,
          json: init.body !== undefined,
        }),
        ...(init.body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: any) {
      if (err.name === "TimeoutError") {
        throw new ProviderError("Mailwarden Bridge request timed out after 15 seconds", "imap");
      }
      throw new ProviderError(`Mailwarden Bridge connection error: ${err.message}`, "imap");
    }
  }

  async testConnection(
    _principal?: AuthPrincipal,
    _accountId?: string
  ): Promise<ConnectionTestResult> {
    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      const startedAt = Date.now();
      try {
        const res = await fetch(`${this.credentials.gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const latencyMs = Date.now() - startedAt;
        if (res.ok) {
          return {
            ok: true,
            code: "success",
            humanMessage: "Successfully reached Mailwarden Bridge Relay.",
            latencyMs,
          };
        }
        return {
          ok: false,
          code: "server_unreachable",
          humanMessage: "Mailwarden Bridge Relay responded with an error.",
          latencyMs,
        };
      } catch (err: any) {
        return {
          ok: false,
          code: "server_unreachable",
          humanMessage: `Could not reach Mailwarden Bridge Relay: ${err.message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    }

    const startedAt = Date.now();
    const client = this.createClient();
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen("INBOX");
      const folders = await client.list().catch(() => []);
      const folderNames = folders.map((f) => f.name || f.path);
      await client.logout().catch(() => {});

      return {
        ok: true,
        code: "success",
        humanMessage: `Successfully connected to ${this.credentials.imap.host}. Found ${mailbox.exists ?? 0} messages in INBOX.`,
        latencyMs: Date.now() - startedAt,
        foldersFound: folderNames,
      };
    } catch (err: any) {
      await client.logout().catch(() => {});
      const msg = err.message || String(err);
      const code = err.code || "";
      const latencyMs = Date.now() - startedAt;

      if (
        err.authenticationFailed ||
        msg.includes("AUTHENTICATIONFAILED") ||
        msg.includes("Invalid credentials") ||
        msg.includes("authentication failed") ||
        msg.includes("Login failed")
      ) {
        return {
          ok: false,
          code: "auth_rejected",
          humanMessage: "Your mail credentials were rejected by the server. Check your username and password, or generate an App Password if 2-Step Verification is enabled.",
          technicalDetail: msg,
          latencyMs,
        };
      }

      if (
        code === "ENOTFOUND" ||
        code === "ECONNREFUSED" ||
        code === "EHOSTUNREACH" ||
        msg.includes("ENOTFOUND") ||
        msg.includes("ECONNREFUSED")
      ) {
        return {
          ok: false,
          code: "server_unreachable",
          humanMessage: `Mailwarden could not reach mail server '${this.credentials.imap.host}' on port ${this.credentials.imap.port}. Verify the host address and port.`,
          technicalDetail: msg,
          latencyMs,
        };
      }

      if (code === "ETIMEDOUT" || msg.includes("Timeout") || msg.includes("timed out")) {
        return {
          ok: false,
          code: "timeout",
          humanMessage: `Connection to '${this.credentials.imap.host}' timed out after 15 seconds. Check firewall or security settings.`,
          technicalDetail: msg,
          latencyMs,
        };
      }

      if (
        code.includes("TLS") ||
        code.includes("CERT") ||
        msg.includes("certificate") ||
        msg.includes("SSL") ||
        msg.includes("TLS")
      ) {
        return {
          ok: false,
          code: "tls_failure",
          humanMessage: "Secure connection (TLS/SSL) negotiation failed. Verify the security mode (SSL/TLS vs STARTTLS) and port.",
          technicalDetail: msg,
          latencyMs,
        };
      }

      return {
        ok: false,
        code: "unknown_error",
        humanMessage: `Could not connect to mail server: ${msg}`,
        technicalDetail: msg,
        latencyMs,
      };
    }
  }

  async listFolders(
    _principal: AuthPrincipal,
    _accountId: string
  ): Promise<NormalizedFolder[]> {
    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      return [
        { id: "inbox", name: "INBOX", path: "INBOX", kind: "inbox" },
        { id: "sent", name: "Sent", path: "Sent", kind: "sent" },
        { id: "drafts", name: "Drafts", path: "Drafts", kind: "drafts" },
        { id: "trash", name: "Trash", path: "Trash", kind: "trash" },
        { id: "archive", name: "Archive", path: "Archive", kind: "archive" },
      ];
    }

    const client = this.createClient();
    await client.connect();
    try {
      const rawFolders = await client.list();
      return rawFolders.map((f, idx) => {
        const kind = classifyImapFolder(f.name || f.path, f.specialUse);
        return {
          id: `folder_${idx}_${encodeURIComponent(f.path)}`,
          name: f.name || f.path,
          path: f.path,
          kind,
          specialUse: f.specialUse,
        };
      });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async getMessage(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<NormalizedEmail> {
    const uid = Number(messageId.replace(/^imap_/, ""));
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new NotFoundError("IMAP message", messageId);
    }

    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      const res = await this.callGateway(principal, accountId, `/messages/${encodeURIComponent(uid)}`);
      if (res.status === 404) throw new NotFoundError("IMAP message", messageId);
      if (!res.ok) throw new ProviderError("Failed to fetch message via Bridge Gateway", "imap");
      return (await res.json()) as NormalizedEmail;
    }

    const client = this.createClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      const message = await client.fetchOne(
        String(uid),
        { uid: true, source: true, flags: true, internalDate: true },
        { uid: true }
      );

      if (!message || !message.source) {
        throw new NotFoundError("IMAP message", messageId);
      }

      return await parseAndNormalizeRawEmail(
        message.source,
        message.uid || uid,
        { tenantId: principal.tenantId, userId: principal.userId, accountId },
        message.flags
      );
    } catch (err: any) {
      if (err instanceof NotFoundError) throw err;
      throw new ProviderError(`IMAP getMessage error: ${err.message}`, "imap", true, err);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async getThread(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string
  ): Promise<NormalizedEmail[]> {
    // In IMAP, threads are aggregated by thread identifier in Mailwarden D1
    const { emailService } = await import("../services/email");
    const result = await emailService.getThread(principal, accountId, threadId, 25);
    return result.messages;
  }

  async search(
    principal: AuthPrincipal,
    accountId: string,
    query: MailSearchQuery
  ): Promise<MailSearchResult> {
    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      const res = await this.callGateway(principal, accountId, "/search", {
        method: "POST",
        body: { query: query.query, limit: query.limit || 25 },
      });
      if (!res.ok) throw new ProviderError("Bridge Gateway search failed", "imap");
      const data = (await res.json()) as any;
      return { messages: data.messages || [], totalEstimated: data.totalEstimated || 0 };
    }

    const client = this.createClient();
    await client.connect();
    try {
      const folderName = query.folder || "INBOX";
      const mailbox = await client.mailboxOpen(folderName);
      const total = mailbox.exists || 0;
      if (total === 0) {
        return { messages: [], totalEstimated: 0 };
      }

      const limit = Math.min(Math.max(query.limit || 25, 1), 50);
      const start = Math.max(1, total - limit + 1);
      const messages: NormalizedEmail[] = [];

      for await (const msg of client.fetch(`${start}:*`, {
        uid: true,
        source: true,
        flags: true,
        internalDate: true,
      })) {
        if (msg.source) {
          try {
            const normalized = await parseAndNormalizeRawEmail(
              msg.source,
              msg.uid,
              { tenantId: principal.tenantId, userId: principal.userId, accountId },
              msg.flags
            );
            messages.push(normalized);
          } catch (e: any) {
            logger.warn("Failed to parse IMAP message source", { uid: msg.uid, error: e.message });
          }
        }
      }

      messages.reverse();

      let filtered = messages;
      if (query.query) {
        const q = query.query.toLowerCase().trim();
        filtered = messages.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) ||
            m.textBody.toLowerCase().includes(q) ||
            m.from.address.toLowerCase().includes(q) ||
            (m.from.name && m.from.name.toLowerCase().includes(q))
        );
      }

      return {
        messages: filtered,
        totalEstimated: total,
      };
    } catch (err: any) {
      throw new ProviderError(`IMAP search error: ${err.message}`, "imap", true, err);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async markRead(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void> {
    const uid = Number(messageId.replace(/^imap_/, ""));
    if (!Number.isInteger(uid) || uid <= 0) return;

    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      await this.callGateway(principal, accountId, `/messages/${encodeURIComponent(uid)}/mutate`, {
        method: "POST",
        body: { action: "mark_read" },
      });
      return;
    }

    const client = this.createClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async markUnread(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void> {
    const uid = Number(messageId.replace(/^imap_/, ""));
    if (!Number.isInteger(uid) || uid <= 0) return;

    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      await this.callGateway(principal, accountId, `/messages/${encodeURIComponent(uid)}/mutate`, {
        method: "POST",
        body: { action: "mark_unread" },
      });
      return;
    }

    const client = this.createClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async archive(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void> {
    const uid = Number(messageId.replace(/^imap_/, ""));
    if (!Number.isInteger(uid) || uid <= 0) return;

    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      await this.callGateway(principal, accountId, `/messages/${encodeURIComponent(uid)}/mutate`, {
        method: "POST",
        body: { action: "archive" },
      });
      return;
    }

    const client = this.createClient();
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
      const folders = await client.list().catch(() => []);
      const archiveFolder = folders.find((f) => classifyImapFolder(f.name || f.path, f.specialUse) === "archive");
      const targetName = archiveFolder ? archiveFolder.path : "Archive";
      await client.messageMove(String(uid), targetName, { uid: true });
    } catch {
      // If move to Archive fails, mark as read/seen as fallback
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async createDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    return {
      ...draft,
      providerDraftId: draft.providerDraftId || `imap_draft_${Date.now()}`,
    };
  }

  async updateDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    return draft;
  }

  async sendDraft(
    principal: AuthPrincipal,
    accountId: string,
    draft: StoredDraft
  ): Promise<SendResult> {
    if (this.credentials.mode === "gateway" && this.credentials.gatewayUrl) {
      if (!config.MAILBOX_MUTATIONS_ENABLED) {
        logger.info("[DRY RUN] Send simulated via Gateway", { to: draft.to.map((t) => t.address), subject: draft.subject });
        return {
          success: true,
          providerMessageId: `gw_simulated_${nanoid()}`,
          draftId: draft.id,
          sentAt: new Date(),
          simulated: true,
        };
      }
      const res = await this.callGateway(principal, accountId, "/send", {
        method: "POST",
        body: draft,
      });
      if (!res.ok) throw new ProviderError("Bridge Gateway send failed", "imap");
      const data = (await res.json()) as any;
      return {
        success: true,
        providerMessageId: data.messageId || `gw_msg_${nanoid()}`,
        draftId: draft.id,
        sentAt: new Date(),
        simulated: false,
      };
    }

    if (!this.credentials.smtp) {
      throw new ProviderError("No SMTP server configured for this mailbox. Incoming IMAP is read-only.", "imap");
    }

    const smtpProvider = new SmtpProvider(this.credentials.smtp);
    return smtpProvider.sendDraft(principal, accountId, draft);
  }
}
