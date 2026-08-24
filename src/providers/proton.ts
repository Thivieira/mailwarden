import type { MailProvider, MailSearchQuery, MailSearchResult } from "./types";
import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import { ProviderError, NotFoundError, ConfigurationError } from "../utils/errors";
import { nanoid } from "nanoid";
import { validateProtonGatewayUrl, type ProtonBridgeCredentials } from "@mailwarden/proton";
import { signGatewayRequest } from "@mailwarden/relay";

export type { ProtonBridgeCredentials } from "@mailwarden/proton";

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
        validateProtonGatewayUrl(creds.gatewayUrl);
      } catch (err: any) {
        throw new ConfigurationError(`Invalid Proton gateway URL: ${err.message}`);
      }
    }
  }

  /**
   * Authenticates one gateway call.
   *
   * A registered relay is addressed by a signed request: the HMAC covers the
   * method, path, timestamp, and body, so the device credential never travels
   * and a captured request cannot be replayed. A relay that predates device
   * identity still authenticates with its bearer key.
   */
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
      ...(this.creds.bridgeUsername ? { "X-Proton-Username": this.creds.bridgeUsername } : {}),
      ...(this.creds.bridgePassword ? { "X-Proton-Password": this.creds.bridgePassword } : {}),
    };

    if (this.creds.deviceGatewaySecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      return {
        ...base,
        "X-Mailwarden-Signature": signGatewayRequest(this.creds.deviceGatewaySecret, {
          method: request.method,
          path: request.path,
          timestamp,
          body: request.body,
        }),
        "X-Mailwarden-Timestamp": String(timestamp),
      };
    }

    return { ...base, Authorization: `Bearer ${this.creds.gatewayApiKey || ""}` };
  }

  /** Single call path, so every request is signed the same way. */
  private async call(
    principal: AuthPrincipal,
    accountId: string,
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    const method = init.method || "GET";
    const body = init.body === undefined ? "" : JSON.stringify(init.body);
    const url = new URL(`${this.creds.gatewayUrl}${path}`);
    return this.fetchWithTimeout(url.toString(), {
      method,
      headers: this.headers(principal, accountId, {
        method,
        path: url.pathname,
        body,
        json: init.body !== undefined,
      }),
      ...(init.body !== undefined ? { body } : {}),
    });
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
      const res = await this.call(principal, accountId, `/messages/${encodeURIComponent(messageId)}`);
      if (res.status === 404) throw new NotFoundError(`Proton message not found: ${messageId}`);
      if (!res.ok) throw new ProviderError(`Proton Gateway error: ${res.statusText}`, "proton");
      return res.json() as Promise<NormalizedEmail>;
    }
    throw new NotFoundError(`Message not found on Proton Bridge: ${messageId}`);
  }

  async getThread(principal: AuthPrincipal, accountId: string, threadId: string): Promise<NormalizedEmail[]> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.call(principal, accountId, `/threads/${encodeURIComponent(threadId)}`);
      if (!res.ok) return [];
      return res.json() as Promise<NormalizedEmail[]>;
    }
    return [];
  }

  async search(principal: AuthPrincipal, accountId: string, query: MailSearchQuery): Promise<MailSearchResult> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.call(principal, accountId, "/search", { method: "POST", body: query });
      if (!res.ok) throw new ProviderError(`Proton Gateway search error: ${res.statusText}`, "proton");
      return res.json() as Promise<MailSearchResult>;
    }
    return { messages: [] };
  }

  async markRead(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.call(principal, accountId, `/messages/${encodeURIComponent(messageId)}/mutate`, {
        method: "POST",
        body: { action: "mark_read" },
      });
    }
  }

  async markUnread(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.call(principal, accountId, `/messages/${encodeURIComponent(messageId)}/mutate`, {
        method: "POST",
        body: { action: "mark_unread" },
      });
    }
  }

  async archive(principal: AuthPrincipal, accountId: string, messageId: string): Promise<void> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      await this.call(principal, accountId, `/messages/${encodeURIComponent(messageId)}/mutate`, {
        method: "POST",
        body: { action: "archive" },
      });
    }
  }

  async createDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<StoredDraft> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.call(principal, accountId, "/drafts", { method: "POST", body: draft });
      if (res.ok) {
        const data = (await res.json()) as any;
        return { ...draft, providerDraftId: data.providerDraftId || `proton_draft_${nanoid()}` };
      }
    }
    return { ...draft, providerDraftId: `proton_draft_${nanoid()}` };
  }

  async updateDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<StoredDraft> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl && draft.providerDraftId) {
      await this.call(principal, accountId, `/drafts/${encodeURIComponent(draft.providerDraftId)}`, {
        method: "PUT",
        body: draft,
      });
    }
    return draft;
  }

  async sendDraft(principal: AuthPrincipal, accountId: string, draft: StoredDraft): Promise<SendResult> {
    if (this.creds.mode === "gateway" && this.creds.gatewayUrl) {
      const res = await this.call(principal, accountId, "/send", { method: "POST", body: draft });
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
        const url = new URL(`${this.creds.gatewayUrl}/health`);
        const timestamp = Math.floor(Date.now() / 1000);
        const res = await this.fetchWithTimeout(url.toString(), {
          headers: this.creds.deviceGatewaySecret
            ? {
                "X-Mailwarden-Signature": signGatewayRequest(this.creds.deviceGatewaySecret, {
                  method: "GET",
                  path: url.pathname,
                  timestamp,
                  body: "",
                }),
                "X-Mailwarden-Timestamp": String(timestamp),
              }
            : { Authorization: `Bearer ${this.creds.gatewayApiKey || ""}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    }
    return true;
  }
}
