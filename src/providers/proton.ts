import type { MailProvider, MailSearchQuery, MailSearchResult } from "./types";
import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import { ProviderError, NotFoundError, ConfigurationError } from "../utils/errors";
import { nanoid } from "nanoid";

export interface ProtonBridgeCredentials {
  mode?: "gateway" | "direct";
  gatewayUrl?: string;
  gatewayApiKey?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  bridgeUsername?: string;
  bridgePassword?: string;
}

export class ProtonBridgeProvider implements MailProvider {
  public readonly provider: ProviderType = "proton";
  private creds: ProtonBridgeCredentials;

  constructor(creds: ProtonBridgeCredentials) {
    this.validateGatewayConfig(creds);
    this.creds = creds;
  }

  private validateGatewayConfig(creds: ProtonBridgeCredentials) {
    if (creds.mode === "gateway" && creds.gatewayUrl) {
      try {
        const parsed = new URL(creds.gatewayUrl);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
          throw new ConfigurationError(`Proton gateway URL must use HTTPS: ${creds.gatewayUrl}`);
        }
        if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
          throw new ConfigurationError("Proton gateway URL cannot target internal cloud metadata endpoints");
        }
      } catch (err: any) {
        throw new ConfigurationError(`Invalid Proton gateway URL: ${err.message}`);
      }
    }
  }

  private headers(principal: AuthPrincipal, accountId: string, json = false): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${this.creds.gatewayApiKey || ""}`,
      "X-Tenant-Id": principal.tenantId,
      "X-User-Id": principal.userId,
      "X-Account-Id": accountId,
    };
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    } catch (err: any) {
      if (err.name === "TimeoutError") throw new ProviderError("Proton Gateway request timed out after 10 seconds", "proton");
      throw new ProviderError(`Proton Gateway connection error: ${err.message}`, "proton");
    }
  }

  async getMessage(principal: AuthPrincipal, accountId: string, messageId: string): Promise<NormalizedEmail> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/messages/${messageId}`, {
        headers: this.headers(principal, accountId),
      });
      if (res.status === 404) throw new NotFoundError(`Proton message not found: ${messageId}`);
      if (!res.ok) throw new ProviderError(`Proton Gateway error: ${res.statusText}`, "proton");
      return res.json() as Promise<NormalizedEmail>;
    }
    throw new NotFoundError(`Message not found on Proton Bridge: ${messageId}`);
  }

  async getThread(principal: AuthPrincipal, accountId: string, threadId: string): Promise<NormalizedEmail[]> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/threads/${encodeURIComponent(threadId)}`, {
        headers: this.headers(principal, accountId),
      });
      if (!res.ok) return [];
      return res.json() as Promise<NormalizedEmail[]>;
    }
    return [];
  }

  async search(principal: AuthPrincipal, accountId: string, query: MailSearchQuery): Promise<MailSearchResult> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/search`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify(query),
      });
      if (!res.ok) throw new ProviderError(`Proton Gateway search error: ${res.statusText}`, "proton");
      return res.json() as Promise<MailSearchResult>;
    }
    return { messages: [] };
  }

  async markRead(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.fetchWithTimeout(`${this.creds.gatewayUrl}/messages/${messageId}/mutate`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify({ action: "mark_read" }),
      });
    }
  }

  async markUnread(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.fetchWithTimeout(`${this.creds.gatewayUrl}/messages/${messageId}/mutate`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify({ action: "mark_unread" }),
      });
    }
  }

  async archive(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.fetchWithTimeout(`${this.creds.gatewayUrl}/messages/${messageId}/mutate`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify({ action: "archive" }),
      });
    }
  }

  async createDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<StoredDraft> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/drafts`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        return { ...draft, providerDraftId: data.providerDraftId || `proton_draft_${nanoid()}` };
      }
    }
    return { ...draft, providerDraftId: `proton_draft_${nanoid()}` };
  }

  async updateDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<StoredDraft> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl && draft.providerDraftId) {
      await this.fetchWithTimeout(`${this.creds.gatewayUrl}/drafts/${draft.providerDraftId}`, {
        method: "PUT",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify(draft),
      });
    }
    return draft;
  }

  async sendDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<SendResult> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/send`, {
        method: "POST",
        headers: this.headers(principal, accountId, true),
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new ProviderError(`Proton Gateway SMTP error: ${res.statusText}`, "proton");
      const result = (await res.json()) as any;
      return { ...result, sentAt: result.sentAt ? new Date(result.sentAt) : new Date() } as SendResult;
    }

    return {
      success: true,
      providerMessageId: `proton_mock_${nanoid()}`,
      draftId: draft.id,
      sentAt: new Date(),
      simulated: true,
    };
  }

  async validateCredentials(): Promise<boolean> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      try {
        const res = await this.fetchWithTimeout(`${this.creds.gatewayUrl}/health`, {
          headers: { Authorization: `Bearer ${this.creds.gatewayApiKey || ""}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    }
    return true;
  }
}
