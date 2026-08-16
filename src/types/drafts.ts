import type { MailAddress, DraftAttachment } from "./domain";

export interface SignatureProfile {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  displayName: string;
  title?: string;
  company?: string;
  email?: string;
  phone?: string;
  website?: string;
  plainText: string;
  html?: string;
  signOff?: string;
  replyMode: "full" | "compact" | "none";
  newMessageMode: "full" | "compact" | "none";
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredDraft {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  identityId: string;

  replyToMessageId?: string;
  threadId?: string;

  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];

  subject: string;
  textBody: string;
  htmlBody?: string;

  signatureProfileId?: string;
  renderedSignature?: string;

  attachments: DraftAttachment[];

  status: "draft" | "approved" | "sent" | "failed";
  providerDraftId?: string;
  revision: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface SendApproval {
  id: string;
  tenantId: string;
  userId: string;
  draftId: string;
  payloadHash: string;
  status: "pending" | "confirmed" | "rejected";
  confirmationNonce: string;
  confirmedByUserId?: string;
  confirmedAt?: Date;
  approvedAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

export interface SendAttempt {
  id: string;
  tenantId: string;
  userId: string;
  draftId: string;
  approvalId: string;
  idempotencyKey: string;
  status: "in_progress" | "sent" | "failed";
  providerMessageId?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendResult {
  success: boolean;
  providerMessageId: string;
  draftId: string;
  sentAt: Date;
  simulated?: boolean;
}
