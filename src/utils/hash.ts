import { createHash } from "crypto";
import type { MailAddress, DraftAttachment } from "../types/domain";

export interface CanonicalSendPayload {
  tenantId: string;
  userId: string;
  accountId: string;
  identityId: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  signatureProfileId?: string;
  renderedSignature?: string;
  replyToMessageId?: string;
  attachments: Array<{
    filename: string;
    contentType?: string;
    size?: number;
    contentHash?: string;
  }>;
}

function normalizeAddress(addr: MailAddress): string {
  const email = addr.address.toLowerCase().trim();
  const name = addr.name ? addr.name.trim() : "";
  return name ? `"${name}" <${email}>` : email;
}

function normalizeAddresses(addrs?: MailAddress[]): string[] {
  if (!addrs || addrs.length === 0) return [];
  return addrs.map(normalizeAddress).sort();
}

/**
 * Creates a deterministic, canonical JSON string representing the exact send payload.
 */
export function canonicalizeSendPayload(payload: CanonicalSendPayload): string {
  const canonicalObj = {
    tenantId: payload.tenantId,
    userId: payload.userId,
    accountId: payload.accountId,
    identityId: payload.identityId,
    to: normalizeAddresses(payload.to),
    cc: normalizeAddresses(payload.cc),
    bcc: normalizeAddresses(payload.bcc),
    subject: payload.subject.trim(),
    textBody: payload.textBody.trim(),
    htmlBody: payload.htmlBody ? payload.htmlBody.trim() : null,
    signatureProfileId: payload.signatureProfileId || null,
    renderedSignature: payload.renderedSignature ? payload.renderedSignature.trim() : null,
    replyToMessageId: payload.replyToMessageId || null,
    attachments: (payload.attachments || [])
      .map((att) => ({
        filename: att.filename.trim(),
        contentType: att.contentType?.toLowerCase() || null,
        size: att.size || 0,
        contentHash: att.contentHash || null,
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename)),
  };

  return JSON.stringify(canonicalObj);
}

/**
 * Generates a SHA-256 hash of the canonical send payload.
 */
export function computeSendPayloadHash(payload: CanonicalSendPayload): string {
  const canonicalString = canonicalizeSendPayload(payload);
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Computes a SHA-256 hex digest for tokens or secrets
 */
export async function hashToken(token: string): Promise<string> {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

