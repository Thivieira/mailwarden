import type { AuthPrincipal } from "../types/auth";
import type { NormalizedEmail, ProviderType } from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import type { MailProvider, MailSearchQuery, MailSearchResult } from "./types";
import { nanoid } from "nanoid";

export class MockMailProvider implements MailProvider {
  readonly provider: ProviderType = "mock";
  private store: Map<string, NormalizedEmail> = new Map();

  constructor(initialEmails?: NormalizedEmail[]) {
    if (initialEmails) {
      for (const email of initialEmails) {
        this.store.set(email.providerMessageId, email);
      }
    }
  }

  async getMessage(
    _principal: AuthPrincipal,
    _accountId: string,
    messageId: string
  ): Promise<NormalizedEmail> {
    const found = this.store.get(messageId);
    if (!found) {
      throw new Error(`[MockProvider] Message ${messageId} not found in mock mailbox`);
    }
    return found;
  }

  async getThread(
    _principal: AuthPrincipal,
    _accountId: string,
    threadId: string
  ): Promise<NormalizedEmail[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.providerThreadId === threadId
    );
  }

  async search(
    _principal: AuthPrincipal,
    _accountId: string,
    query: MailSearchQuery
  ): Promise<MailSearchResult> {
    const all = Array.from(this.store.values());
    if (!query.query) {
      return { messages: all.slice(0, query.limit || 20) };
    }

    const q = query.query.toLowerCase();
    const filtered = all.filter(
      (e) =>
        e.subject.toLowerCase().includes(q) ||
        e.textBody.toLowerCase().includes(q) ||
        e.from.address.toLowerCase().includes(q)
    );

    return {
      messages: filtered.slice(0, query.limit || 20),
      totalEstimated: filtered.length,
    };
  }

  async markRead(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    const msg = this.store.get(messageId);
    if (msg) {
      msg.flags.unread = false;
    }
  }

  async markUnread(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    const msg = this.store.get(messageId);
    if (msg) {
      msg.flags.unread = true;
    }
  }

  async archive(_principal: AuthPrincipal, _accountId: string, messageId: string): Promise<void> {
    const msg = this.store.get(messageId);
    if (msg) {
      msg.flags.archived = true;
    }
  }

  async createDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft> {
    return {
      ...draft,
      providerDraftId: `mock_draft_${nanoid()}`,
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
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<SendResult> {
    const providerMessageId = `mock_sent_${nanoid()}`;
    return {
      success: true,
      providerMessageId,
      draftId: draft.id,
      sentAt: new Date(),
      simulated: true,
    };
  }
}
