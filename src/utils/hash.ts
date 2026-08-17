import { createHash } from "crypto";
import type { MailAddress } from "../types/domain";

/**
 * Canonical outbound payload — exactly the values that affect Gmail delivery for v1,
 * plus security-binding ids. Non-provider metadata (renderedSignature, replyToMessageId,
 * signatureProfileId) is intentionally absent: textBody is already the final rendered body.
 */
export interface CanonicalSendPayload {
  tenantId: string;
  userId: string;
  accountId: string;
  identityId: string;
  /** Effective From address that must match the connected Gmail account. */
  fromEmail: string;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  /** Final plain-text body exactly as Gmail will send it (signature already composed). */
  textBody: string;
  /** Gmail /messages/send threadId; empty/null means a new conversation. */
  threadId: string | null;
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
 * Creates a deterministic JSON string for the exact canonical outbound payload.
 * This is not a claim of hashing raw MIME bytes — it hashes the outbound semantics.
 */
export function canonicalizeSendPayload(payload: CanonicalSendPayload): string {
  const canonicalObj = {
    tenantId: payload.tenantId,
    userId: payload.userId,
    accountId: payload.accountId,
    identityId: payload.identityId,
    fromEmail: payload.fromEmail.toLowerCase().trim(),
    to: normalizeAddresses(payload.to),
    cc: normalizeAddresses(payload.cc),
    subject: payload.subject.trim(),
    textBody: payload.textBody,
    threadId: payload.threadId || null,
  };

  return JSON.stringify(canonicalObj);
}

export function computeSendPayloadHash(payload: CanonicalSendPayload): string {
  const canonicalString = canonicalizeSendPayload(payload);
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

export async function hashToken(token: string): Promise<string> {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
