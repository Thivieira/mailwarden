import { db, schema } from "../db";
import { authService } from "../services/auth";
import { emailService } from "../services/email";
import { relationshipService } from "../services/relationships";
import { ALL_SCOPES } from "../types/auth";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger";

export async function seedDevData() {
  logger.info("🌱 Seeding realistic development data...");

  // 1. Create Tenant & Owner
  const ownerEmail = "alice@acme.com";
  const { tenantId, userId, token } = await authService.createTenantAndOwner({
    tenantName: "Acme Holdings",
    slug: "acme",
    ownerEmail,
    ownerDisplayName: "Alice Smith",
  });

  const principal = {
    tenantId,
    userId,
    scopes: ALL_SCOPES,
    email: ownerEmail,
    displayName: "Alice Smith",
  };

  // 2. Create Connected Accounts
  const now = new Date();
  const gmailAccId = nanoid();
  const outlookAccId = nanoid();
  const protonAccId = nanoid();

  await db.insert(schema.emailAccounts).values([
    {
      id: gmailAccId,
      tenantId,
      userId,
      provider: "gmail",
      displayName: "Acme Work Gmail",
      emailAddress: "alice@acme.com",
      status: "connected",
      priorityRole: "primary_work",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: outlookAccId,
      tenantId,
      userId,
      provider: "outlook",
      displayName: "Consulting Outlook",
      emailAddress: "alice.smith@consultancy.com",
      status: "connected",
      priorityRole: "freelance",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: protonAccId,
      tenantId,
      userId,
      provider: "proton",
      displayName: "Personal Proton Mail",
      emailAddress: "alice.secure@proton.me",
      status: "connected",
      priorityRole: "personal",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // 3. Create Identities
  const gmailIdentityId = nanoid();
  const outlookIdentityId = nanoid();
  await db.insert(schema.emailIdentities).values([
    {
      id: gmailIdentityId,
      tenantId,
      userId,
      accountId: gmailAccId,
      email: "alice@acme.com",
      displayName: "Alice Smith",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: outlookIdentityId,
      tenantId,
      userId,
      accountId: outlookAccId,
      email: "alice.smith@consultancy.com",
      displayName: "Alice Smith (Consultant)",
      canSend: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // 4. Create Relationships & Organizations
  await relationshipService.setSenderRelationship(principal, {
    emailAddress: "bob@clientcorp.com",
    type: "client",
    organizationName: "ClientCorp Inc",
    notes: "Main point of contact for Q3 redesign",
  });
  await relationshipService.associateSenderWithProject(principal, "bob@clientcorp.com", "Website Redesign");

  await relationshipService.setSenderRelationship(principal, {
    emailAddress: "sarah@techrecruiting.com",
    type: "recruiter",
    organizationName: "Tech Talent Group",
    notes: "VP of Engineering search",
  });

  // 5. Ingest Sample Emails
  const sampleEmails: Array<{
    accountId: string;
    provider: "gmail" | "outlook" | "proton";
    providerMessageId: string;
    providerThreadId?: string;
    from: { name?: string; address: string };
    to: Array<{ name?: string; address: string }>;
    cc: Array<{ name?: string; address: string }>;
    bcc: Array<{ name?: string; address: string }>;
    subject: string;
    textBody: string;
    receivedAt: Date;
    headers: Record<string, string>;
    flags: { unread: boolean; bulk: boolean; automated: boolean; hasListUnsubscribe: boolean };
    attachments: Array<{ id: string; filename: string; size?: number; contentType?: string }>;
  }> = [
    {
      accountId: gmailAccId,
      provider: "gmail" as const,
      providerMessageId: "msg_client_001",
      providerThreadId: "thread_client_001",
      from: { name: "Bob Jones", address: "bob@clientcorp.com" },
      to: [{ name: "Alice Smith", address: "alice@acme.com" }],
      cc: [],
      bcc: [],
      subject: "Urgent: Timeline check for Website Redesign deliverables",
      textBody: "Hi Alice,\n\nCould you please review the attached draft milestones and confirm if we are still on track for delivery by Friday?\n\nOur executive team needs the final sign-off before EOD.\n\nThanks,\nBob",
      receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [{ id: "att_01", filename: "milestones_v2.pdf", size: 1048576, contentType: "application/pdf" }],
    },
    {
      accountId: gmailAccId,
      provider: "gmail" as const,
      providerMessageId: "msg_recruiter_001",
      providerThreadId: "thread_recruiter_001",
      from: { name: "Sarah Jenkins", address: "sarah@techrecruiting.com" },
      to: [{ name: "Alice Smith", address: "alice@acme.com" }],
      cc: [],
      bcc: [],
      subject: "Career opportunity: VP of Engineering discussion",
      textBody: "Hi Alice,\n\nI came across your profile and was thoroughly impressed with your engineering background. Would you be open to a 15-minute introductory call next Tuesday to discuss a leadership role?\n\nBest,\nSarah",
      receivedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      headers: {},
      flags: { unread: true, bulk: false, automated: false, hasListUnsubscribe: false },
      attachments: [],
    },
    {
      accountId: outlookAccId,
      provider: "outlook" as const,
      providerMessageId: "msg_billing_001",
      from: { name: "Cloud Services Billing", address: "billing@saasservice.com" },
      to: [{ name: "Alice Smith", address: "alice.smith@consultancy.com" }],
      cc: [],
      bcc: [],
      subject: "Invoice #INV-2026-8942 Available for Review",
      textBody: "Dear Customer,\n\nYour monthly subscription invoice #INV-2026-8942 for $450.00 is now ready. Payment is scheduled to be processed on August 20th.\n\nThank you for your business.",
      receivedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      headers: {},
      flags: { unread: false, bulk: true, automated: true, hasListUnsubscribe: false },
      attachments: [],
    },
    {
      accountId: protonAccId,
      provider: "proton" as const,
      providerMessageId: "msg_security_001",
      from: { name: "Security Team", address: "no-reply@authservice.com" },
      to: [{ address: "alice.secure@proton.me" }],
      cc: [],
      bcc: [],
      subject: "Security Alert: Verification code for new sign-in",
      textBody: "Your one-time security verification code is 849201. If you did not initiate this login attempt, please change your password immediately.",
      receivedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 mins ago
      headers: {},
      flags: { unread: true, bulk: false, automated: true, hasListUnsubscribe: false },
      attachments: [],
    },
    {
      accountId: gmailAccId,
      provider: "gmail" as const,
      providerMessageId: "msg_newsletter_001",
      from: { name: "Weekly Tech Digest", address: "newsletter@techweekly.com" },
      to: [{ name: "Alice Smith", address: "alice@acme.com" }],
      cc: [],
      bcc: [],
      subject: "Weekly Tech Digest #142: Future of Autonomous AI Systems",
      textBody: "Here is your weekly roundup of top AI and engineering stories. Enjoy your reading!\n\nTo unsubscribe, click here.",
      receivedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      headers: { "list-unsubscribe": "<mailto:unsub@techweekly.com>" },
      flags: { unread: true, bulk: true, automated: true, hasListUnsubscribe: true },
      attachments: [],
    },
  ];

  for (const email of sampleEmails) {
    await emailService.ingestEmail(principal, email);
  }

  logger.info("✅ Seed data populated successfully!");
  logger.info(`🔑 Dev Token for Alice: Bearer ${token}`);

  return { tenantId, userId, token };
}

if (import.meta.main) {
  seedDevData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed error:", err);
      process.exit(1);
    });
}
