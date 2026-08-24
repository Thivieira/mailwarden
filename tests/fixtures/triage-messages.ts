import type { TriageFeatureMessage } from "../../packages/triage-features/src";

const receivedAt = "2026-08-24T12:00:00.000Z";

export interface FeatureFixture {
  name: string;
  message: TriageFeatureMessage;
  expected: {
    payment?: string;
    security?: string;
    infrastructure?: string;
    entity?: string;
    credential?: "valid" | "expired";
  };
}

function message(subject: string, textBody: string, from = "alerts@example.com"): TriageFeatureMessage {
  return {
    providerMessageId: subject,
    from: { address: from },
    subject,
    textBody,
    receivedAt,
    headers: {},
    flags: { automated: true, bulk: false, hasListUnsubscribe: false },
  };
}

export const FEATURE_FIXTURES: FeatureFixture[] = [
  { name: "Adaflow payment failed", message: message("Payment failed", "Your payment of 297 BRL failed.", "billing@adaflow.com"), expected: { payment: "payment_failed" } },
  { name: "Stripe payout failed", message: message("Payout failed", "Payout failed for acct_123.", "notify@stripe.com"), expected: { payment: "payout_failed" } },
  { name: "Stripe invoice paid", message: message("Invoice paid", "Invoice in_123 was paid successfully.", "notify@stripe.com"), expected: { payment: "payment_succeeded", entity: "in_123" } },
  { name: "Google OAuth grant", message: message("New app access", "Access was granted to Example App using OAuth.", "accounts-noreply@google.com"), expected: { security: "oauth_grant" } },
  { name: "Google login notification", message: message("New sign-in", "New login from an unrecognized device.", "accounts-noreply@google.com"), expected: { security: "new_login" } },
  { name: "Cloudflare certificate activity", message: message("Certificate activity", "A certificate was issued for example.com.", "notify@cloudflare.com"), expected: { infrastructure: "certificate_event", security: "certificate_change" } },
  { name: "Google Search Console 5xx", message: message("HTTP 5xx errors", "GSC detected HTTP 500 responses on example.com."), expected: { infrastructure: "http_5xx" } },
  { name: "Railway Postgres upgrade", message: message("Postgres upgraded", "Your Postgres database was automatically upgraded.", "notify@railway.app"), expected: { infrastructure: "database_upgraded" } },
  { name: "Jira overdue issue", message: message("SKAFE-123 overdue", "Issue SKAFE-123 is due on August 27."), expected: { entity: "SKAFE-123" } },
  { name: "verification code with stated TTL", message: message("Verification code 849201", "Your verification code is 849201 and expires in 10 minutes."), expected: { credential: "valid" } },
  { name: "verification code without stated TTL", message: message("Login code", "Use login code 849201."), expected: { credential: "valid" } },
  { name: "expired verification code", message: { ...message("Verification code", "Your code is 849201 and expires in 10 minutes."), receivedAt: "2026-08-24T10:00:00.000Z" }, expected: { credential: "expired" } },
  { name: "newsletter", message: { ...message("Weekly newsletter", "News from the week."), headers: { "List-Unsubscribe": "<mailto:leave@example.com>" }, flags: { automated: true, bulk: true, hasListUnsubscribe: true } }, expected: {} },
  { name: "marketing urgency", message: message("URGENT! 50% off today", "Buy now before the offer ends."), expected: {} },
  { name: "GitHub PR notification", message: message("PR #52 updated", "GitHub pull request #52 received new commits.", "notifications@github.com"), expected: { entity: "52" } },
  { name: "Airbnb reservation message", message: message("Reservation update", "Your stay reservation details changed.", "automated@airbnb.com"), expected: {} },
];
