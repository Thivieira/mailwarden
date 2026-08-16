import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import type { MailProvider, MailSearchQuery, MailSearchResult } from "./types";
import { ProviderError } from "../utils/errors";
import { config } from "../config";
import { sanitizeEmailContent } from "../utils/sanitizer";
import { logger } from "../utils/logger";

export interface OutlookCredentials {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: number;
}

export class OutlookProvider implements MailProvider {
  readonly provider: ProviderType = "outlook";
  private credentials: OutlookCredentials;

  constructor(credentials: OutlookCredentials) {
    this.credentials = credentials;
  }

  private async getValidAccessToken(): Promise<string> {
    if (this.credentials.accessToken && this.credentials.expiresAt && Date.now() < this.credentials.expiresAt - 60000) {
      return this.credentials.accessToken;
    }

    if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
      if (this.credentials.accessToken) return this.credentials.accessToken;
      throw new ProviderError("Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET for Outlook token refresh", "outlook");
    }

    try {
      const tokenUrl = `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
      const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.MICROSOFT_CLIENT_ID,
          client_secret: config.MICROSOFT_CLIENT_SECRET,
          refresh_token: this.credentials.refreshToken,
          grant_type: "refresh_token",
          scope: "https://graph.microsoft.com/.default offline_access",
        }),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new ProviderError(`Failed to refresh Outlook token: ${errorText}`, "outlook");
      }

      const data = (await resp.json()) as any;
      this.credentials.accessToken = data.access_token;
      this.credentials.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      return this.credentials.accessToken!;
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Outlook token refresh error: ${err.message}`, "outlook", true, err);
    }
  }

  private async callGraphApi(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.getValidAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    const resp = await fetch(`https://graph.microsoft.com/v1.0/me${endpoint}`, {
      ...options,
      headers,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new ProviderError(`Microsoft Graph API error (${resp.status}): ${errBody}`, "outlook", resp.status >= 500);
    }

    if (resp.status === 204) return null;
    return resp.json();
  }

  async getMessage(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<NormalizedEmail> {
    const raw = await this.callGraphApi(`/messages/${messageId}`);
    return this.mapGraphMessageToNormalized(principal, accountId, raw);
  }

  async getThread(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string
  ): Promise<NormalizedEmail[]> {
    const resp = await this.callGraphApi(`/messages?$filter=conversationId eq '${threadId}'&$orderby=receivedDateTime asc`);
    const msgs = resp.value || [];
    return msgs.map((m: any) => this.mapGraphMessageToNormalized(principal, accountId, m));
  }

  async search(
    principal: AuthPrincipal,
    accountId: string,
    query: MailSearchQuery
  ): Promise<MailSearchResult> {
    const params = new URLSearchParams();
    if (query.query) params.set("$search", `"${query.query}"`);
    if (query.limit) params.set("$top", query.limit.toString());

    const resp = await this.callGraphApi(`/messages?${params.toString()}`);
    const items = resp.value || [];
    const messages = items.map((m: any) => this.mapGraphMessageToNormalized(principal, accountId, m));

    return {
      messages,
      totalEstimated: messages.length,
    };
  }

  async markRead(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGraphApi(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  }

  async markUnread(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGraphApi(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: false }),
    });
  }

  async archive(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    await this.callGraphApi(`/messages/${messageId}/move`, {
      method: "POST",
      body: JSON.stringify({ destinationId: "archive" }),
    });
  }

  async createDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    const graphDraft = {
      subject: draft.subject,
      body: {
        contentType: draft.htmlBody ? "HTML" : "Text",
        content: draft.htmlBody || draft.textBody,
      },
      toRecipients: draft.to.map((t) => ({ emailAddress: { name: t.name, address: t.address } })),
      ccRecipients: (draft.cc || []).map((c) => ({ emailAddress: { name: c.name, address: c.address } })),
    };

    const resp = await this.callGraphApi(`/messages`, {
      method: "POST",
      body: JSON.stringify(graphDraft),
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
    if (!draft.providerDraftId) return this.createDraft(_principal, _accountId, draft);

    const graphDraft = {
      subject: draft.subject,
      body: {
        contentType: draft.htmlBody ? "HTML" : "Text",
        content: draft.htmlBody || draft.textBody,
      },
      toRecipients: draft.to.map((t) => ({ emailAddress: { name: t.name, address: t.address } })),
    };

    await this.callGraphApi(`/messages/${draft.providerDraftId}`, {
      method: "PATCH",
      body: JSON.stringify(graphDraft),
    });

    return draft;
  }

  async sendDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<SendResult> {
    const graphMessage = {
      message: {
        subject: draft.subject,
        body: {
          contentType: draft.htmlBody ? "HTML" : "Text",
          content: draft.htmlBody || draft.textBody,
        },
        toRecipients: draft.to.map((t) => ({ emailAddress: { name: t.name, address: t.address } })),
        ccRecipients: (draft.cc || []).map((c) => ({ emailAddress: { name: c.name, address: c.address } })),
      },
      saveToSentItems: true,
    };

    await this.callGraphApi(`/sendMail`, {
      method: "POST",
      body: JSON.stringify(graphMessage),
    });

    return {
      success: true,
      providerMessageId: `graph_sent_${Date.now()}`,
      draftId: draft.id,
      sentAt: new Date(),
    };
  }

  private mapGraphMessageToNormalized(
    principal: AuthPrincipal,
    accountId: string,
    raw: any
  ): NormalizedEmail {
    const fromAddr = raw.from?.emailAddress?.address || "unknown@example.com";
    const fromName = raw.from?.emailAddress?.name;

    const to = (raw.toRecipients || []).map((r: any) => ({
      name: r.emailAddress?.name,
      address: r.emailAddress?.address || "",
    }));

    const cc = (raw.ccRecipients || []).map((r: any) => ({
      name: r.emailAddress?.name,
      address: r.emailAddress?.address || "",
    }));

    const sanitized = sanitizeEmailContent(raw.body?.content, raw.body?.contentType === "html" ? raw.body?.content : undefined);

    return {
      id: raw.id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      accountId,
      provider: "outlook",
      providerMessageId: raw.id,
      providerThreadId: raw.conversationId,
      from: { name: fromName, address: fromAddr },
      to,
      cc,
      bcc: [],
      subject: raw.subject || "(No Subject)",
      textBody: sanitized.plainText,
      htmlBody: sanitized.safeHtml,
      snippet: raw.bodyPreview,
      receivedAt: new Date(raw.receivedDateTime || Date.now()),
      headers: {},
      flags: {
        unread: !raw.isRead,
        bulk: sanitized.hasTrackingPixels,
        automated: false,
        hasListUnsubscribe: false,
      },
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
