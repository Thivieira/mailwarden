import { db, schema } from "../db";
import { desc } from "drizzle-orm";
import { triageEventService } from "../services/triage-events";
import { ALL_SCOPES, type AuthPrincipal } from "../types/auth";
import { logger } from "../utils/logger";

async function main() {
  const args = process.argv.slice(2);
  let limit = 100;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]!, 10);
  }

  logger.info(`🔄 Running intelligence replay for up to ${limit} emails...`);

  const emails = await db
    .select()
    .from(schema.emails)
    .orderBy(desc(schema.emails.receivedAt))
    .limit(limit);

  logger.info(`Found ${emails.length} stored emails to replay.`);

  let replayedCount = 0;

  for (const row of emails) {
    const principal: AuthPrincipal = {
      tenantId: row.tenantId,
      userId: row.userId,
      scopes: ALL_SCOPES,
    };

    const normalizedEmail = {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      accountId: row.accountId,
      provider: row.provider as any,
      providerMessageId: row.providerMessageId,
      providerThreadId: row.providerThreadId || undefined,
      from: { name: row.fromName || undefined, address: row.fromAddress },
      to: row.toAddresses || [],
      cc: row.ccAddresses || [],
      bcc: row.bccAddresses || [],
      subject: row.subject,
      textBody: row.textBody,
      htmlBody: row.htmlBody || undefined,
      receivedAt: row.receivedAt,
      headers: row.headers || {},
      flags: row.flags || { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    const { eventId, facts } = await triageEventService.recordMessage(principal, normalizedEmail);

    logger.info(`[REPLAY] ${normalizedEmail.id} | From: ${normalizedEmail.from.address} | Subject: "${normalizedEmail.subject.slice(0, 30)}..."`, {
      eventId,
      factsVersion: facts.featureVersion,
      extractedFacts: facts.paymentEvents.length + facts.securityEvents.length + facts.infrastructureEvents.length,
    });

    replayedCount++;
  }

  logger.info(`✅ Replay complete: ${replayedCount} emails processed through feature extraction and event clustering.`);
}

main().catch((err) => {
  console.error("Replay error:", err);
  process.exit(1);
});
