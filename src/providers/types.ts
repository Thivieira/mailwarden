import type { AuthPrincipal } from "../types/auth";
import type {
  NormalizedEmail,
  ProviderType,
  MailboxActionType,
} from "../types/domain";
import type { StoredDraft, SendResult } from "../types/drafts";
import type {
  MailProviderCapabilities,
  NormalizedFolder,
  ConnectionTestResult,
} from "@mailwarden/contracts";

export type {
  MailProviderCapabilities,
  NormalizedFolder,
  ConnectionTestResult,
};

export interface MailSearchQuery {
  query?: string;
  limit?: number;
  pageToken?: string;
  folder?: string;
}

export interface MailSearchResult {
  messages: NormalizedEmail[];
  nextPageToken?: string;
  totalEstimated?: number;
}

export interface MailProvider {
  readonly provider: ProviderType;

  getCapabilities?(): MailProviderCapabilities;

  getMessage(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<NormalizedEmail>;

  getThread(
    principal: AuthPrincipal,
    accountId: string,
    threadId: string
  ): Promise<NormalizedEmail[]>;

  search(
    principal: AuthPrincipal,
    accountId: string,
    query: MailSearchQuery
  ): Promise<MailSearchResult>;

  listFolders?(
    principal: AuthPrincipal,
    accountId: string
  ): Promise<NormalizedFolder[]>;

  testConnection?(
    principal: AuthPrincipal,
    accountId: string
  ): Promise<ConnectionTestResult>;

  markRead(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void>;

  markUnread(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void>;

  archive(
    principal: AuthPrincipal,
    accountId: string,
    messageId: string
  ): Promise<void>;

  createDraft(
    principal: AuthPrincipal,
    accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft>;

  updateDraft(
    principal: AuthPrincipal,
    accountId: string,
    draft: StoredDraft
  ): Promise<StoredDraft>;

  sendDraft(
    principal: AuthPrincipal,
    accountId: string,
    draft: StoredDraft
  ): Promise<SendResult>;
}

