import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import type { MailProvider, MailSearchQuery, MailSearchResult } from "./types";
import { ProviderError } from "../utils/errors";
import { config } from "../config";
import { sanitizeEmailContent } from "../utils/sanitizer";
import { logger } from "../utils/logger";

export interface GmailCredentials {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: number;
}

export class GmailProvider implements MailProvider {
  readonly provider: ProviderType = "gmail";
  private credentials: GmailCredentials;

  constructor(credentials: GmailCredentials) {
    this.credentials = credentials;
  }

  private async getValidAccessToken(): Promise<string> {
    if (this.credentials.accessToken && this.credentials.expiresAt && Date.now() < this.credentials.expiresAt - 60000) {
      return this.credentials.accessToken;
    }

    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      logger.warn("Google OAuth client credentials not configured in environment. Using fallback access token.");
      if (this.credentials.accessToken) return this.credentials.accessToken;
      throw new ProviderError("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET for Gmail token refresh", "gmail");
    }

    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.GOOGLE_CLIENT_ID,
          client_secret: config.GOOGLE_CLIENT_SECRET,
          refresh_token: this.credentials.refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new ProviderError(`Failed to refresh Gmail token: ${errorText}`, "gmail");
      }

      const data = (await resp.json()) as any;
      this.credentials.accessToken = data.access_token;
      this.credentials.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      return this.credentials.accessToken!;
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Gmail token refresh error: ${err.message}`, "gmail", true, err);
    }
  }

  private async callGmailApi(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.getValidAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, {
      ...options,
      headers,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new ProviderError(`Gmail API error (${resp.status}): ${errBody}`, "gmail", resp.status >= 500);
    }

    if (resp.status === 204) return null;
    return resp.json();
  }

  async getMessage(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<NormalizedEmail> {
    const raw = await this.callGmailApi(`/messages/${messageId}?format=full`);
    return this.mapGmailMessageToNormalized(principal, accountId, raw);
  }

  async getThread(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string
  ): Promise<NormalizedEmail[]> {
    const rawThread = await this.callGmailApi(`/threads/${threadId}?format=full`);
    const msgs = rawThread.messages || [];
    return msgs.map((m: any) => this.mapGmailMessageToNormalized(principal, accountId, m));
  }

  async search(
    principal: AuthPrincipal,
    accountId: string,
    query: MailSearchQuery
  ): Promise<MailSearchResult> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    if (query.limit) params.set("maxResults", query.limit.toString());
    if (query.pageToken) params.set("pageToken", query.pageToken);

    const listResp = await this.callGmailApi(`/messages?${params.toString()}`);
    const messageHeaders = listResp.messages || [];

    const messages: NormalizedEmail[] = [];
    for (const h of messageHeaders.slice(0, 10)) {
      try {
        const fullMsg = await this.getMessage(principal, accountId, h.id);
        messages.push(fullMsg);
      } catch (err: any) {
        logger.warn(`Failed to fetch full Gmail message ${h.id}`, { error: err.message });
      }
    }

    return {
      messages,
      nextPageToken: listResp.nextPageToken,
      totalEstimated: listResp.resultSizeEstimate,
    };
  }

  async markRead(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGmailApi(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  }

  async markUnread(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGmailApi(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["UNREAD"] }),
    });
  }

  async archive(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGmailApi(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  }

  async createDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    const rawMime = this.buildMimeMessage(draft);
    const encoded = Buffer.from(rawMime).toString("base64url");

    const resp = await this.callGmailApi(`/drafts`, {
      method: "POST",
      body: JSON.stringify({ message: { raw: encoded } }),
    });

    return {
      ...draft,
      providerDraftId: resp.id,
    };
  }

  async updateDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    if (!draft.providerDraftId) {
      return this.createDraft(_principal, _accountId, draft);
    }

    const rawMime = this.buildMimeMessage(draft);
    const encoded = Buffer.from(rawMime).toString("base64url");

    await this.callGmailApi(`/drafts/${draft.providerDraftId}`, {
      method: "PUT",
      body: JSON.stringify({ message: { raw: encoded } }),
    });

    return draft;
  }

  async sendDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<SendResult> {
    const rawMime = this.buildMimeMessage(draft);
    const encoded = Buffer.from(rawMime).toString("base64url");

    const resp = await this.callGmailApi(`/messages/send`, {
      method: "POST",
      body: JSON.stringify({ raw: encoded, threadId: draft.threadId }),
    });

    return {
      success: true,
      providerMessageId: resp.id,
      draftId: draft.id,
      sentAt: new Date(),
    };
  }

  private buildMimeMessage(draft: StoredDraft): string {
    const toHeader = draft.to.map((t) => (t.name ? `"${t.name}" <${t.address}>` : t.address)).join(", ");
    const ccHeader = (draft.cc || []).map((c) => (c.name ? `"${c.name}" <${c.address}>` : c.address)).join(", ");

    let mime = `To: ${toHeader}\r\n`;
    if (ccHeader) mime += `Cc: ${ccHeader}\r\n`;
    mime += `Subject: ${draft.subject}\r\n`;
    mime += `MIME-Version: 1.0\r\n`;
    mime += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    mime += draft.textBody;

    return mime;
  }

  private mapGmailMessageToNormalized(
    principal: AuthPrincipal,
    accountId: string,
    raw: any
  ): NormalizedEmail {
    const headersMap: Record<string, string> = {};
    for (const h of raw.payload?.headers || []) {
      headersMap[h.name.toLowerCase()] = h.value;
    }

    const fromHeader = headersMap["from"] || "unknown@example.com";
    const fromNameMatch = fromHeader.match(/^(?:["']?([^"']+)["']?\s*)?<([^>]+)>/);
    const from = fromNameMatch
      ? { name: fromNameMatch[1], address: fromNameMatch[2]! }
      : { address: fromHeader };

    const toHeaders = (headersMap["to"] || "").split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
    const labelIds: string[] = raw.labelIds || [];
    const isUnread = labelIds.includes("UNREAD");

    const textBody = raw.snippet || "";
    const sanitized = sanitizeEmailContent(textBody);

    return {
      id: raw.id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      provider: "gmail",
      providerMessageId: raw.id,
      providerThreadId: raw.threadId,
      from,
      to: toHeaders,
      cc: [],
      bcc: [],
      subject: headersMap["subject"] || "(No Subject)",
      textBody: sanitized.plainText,
      htmlBody: sanitized.safeHtml,
      snippet: raw.snippet,
      receivedAt: new Date(parseInt(raw.internalDate, 10) || Date.now()),
      headers: headersMap,
      flags: {
        unread: isUnread,
        bulk: sanitized.hasTrackingPixels || Boolean(headersMap["list-unsubscribe"]),
        automated: Boolean(headersMap["auto-submitted"]),
        hasListUnsubscribe: Boolean(headersMap["list-unsubscribe"]),
      },
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
