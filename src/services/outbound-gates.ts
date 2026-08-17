import { db, schema } from "../db";
import { and, eq } from "drizzle-orm";
import type { StoredDraft } from "../types/drafts";
import { ValidationError } from "../utils/errors";

/**
 * Gmail v1 outbound gates. Unsupported fields must fail before approval or dispatch —
 * never silently hashed or dropped at the wire.
 */
export function assertGmailOutboundSupported(draft: StoredDraft): void {
  if (draft.bcc && draft.bcc.length > 0) {
    throw new ValidationError(
      "Bcc is not supported for Gmail send in this release. Remove Bcc before requesting approval."
    );
  }
  if (draft.htmlBody && draft.htmlBody.trim().length > 0) {
    throw new ValidationError(
      "HTML body is not supported for Gmail send in this release. Use plain text only."
    );
  }
  if (draft.attachments && draft.attachments.length > 0) {
    throw new ValidationError(
      "Attachments are not supported for Gmail send in this release. Remove attachments before requesting approval."
    );
  }
}

/** Identity must belong to the draft account and match the connected Gmail address. */
export async function assertEffectiveFromMatchesAccount(draft: StoredDraft): Promise<string> {
  const [identity] = await db
    .select()
    .from(schema.emailIdentities)
    .where(
      and(
        eq(schema.emailIdentities.id, draft.identityId),
        eq(schema.emailIdentities.tenantId, draft.tenantId),
        eq(schema.emailIdentities.userId, draft.userId),
        eq(schema.emailIdentities.accountId, draft.accountId)
      )
    )
    .limit(1);

  if (!identity) {
    throw new ValidationError("Sending identity is missing or does not belong to this draft's account");
  }

  const [account] = await db
    .select()
    .from(schema.emailAccounts)
    .where(
      and(
        eq(schema.emailAccounts.id, draft.accountId),
        eq(schema.emailAccounts.tenantId, draft.tenantId),
        eq(schema.emailAccounts.userId, draft.userId)
      )
    )
    .limit(1);

  if (!account) {
    throw new ValidationError("Connected email account for this draft was not found");
  }

  if (identity.email.toLowerCase().trim() !== account.emailAddress.toLowerCase().trim()) {
    throw new ValidationError(
      `Identity email '${identity.email}' does not match connected account '${account.emailAddress}'. Arbitrary Send-As aliases are not supported in this release.`
    );
  }

  return account.emailAddress;
}
