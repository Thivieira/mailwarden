export type ProviderType = "gmail" | "outlook" | "proton" | "mock";

export type AccountStatus = "connected" | "disconnected" | "error" | "reauth_required";

export type AccountPriorityRole =
  | "primary_work"
  | "personal"
  | "freelance"
  | "entertainment"
  | "low_priority";

export interface MailAddress {
  name?: string;
  address: string;
}

export interface NormalizedAttachment {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  contentHash?: string;
  contentUrl?: string;
}

export interface DraftAttachment {
  id?: string;
  filename: string;
  contentType?: string;
  size?: number;
  contentHash?: string;
  dataBase64?: string;
}

export interface EmailFlags {
  unread: boolean;
  starred?: boolean;
  draft?: boolean;
  archived?: boolean;
  bulk: boolean;
  automated: boolean;
  hasListUnsubscribe: boolean;
  transactional?: boolean;
}

export interface NormalizedEmail {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  provider: ProviderType;

  providerMessageId: string;
  providerThreadId?: string;

  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo?: MailAddress[];

  subject: string;
  textBody: string;
  htmlBody?: string;

  receivedAt: Date;
  sentAt?: Date;

  headers: Record<string, string>;
  flags: EmailFlags;
  attachments: NormalizedAttachment[];

  snippet?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailAccount {
  id: string;
  tenantId: string;
  userId: string;
  provider: ProviderType;
  displayName: string;
  emailAddress: string;
  status: AccountStatus;
  priorityRole: AccountPriorityRole;
  errorMessage?: string;
  lastSyncedAt?: Date;
  syncCursor?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailIdentity {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  email: string;
  displayName?: string;
  canSend: boolean;
  defaultSignatureProfileId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  domain?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  status: "active" | "archived" | "planned";
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MailboxActionType = "mark_read" | "mark_unread" | "archive";
