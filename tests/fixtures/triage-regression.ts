import type { TriageFeatureMessage } from "../../packages/triage-features/src";
import type { ExternalTriageDecision } from "../../packages/triage-contract/src";
import type { PriorityBand, PriorityLane } from "../../packages/triage-priority/src";

export const EVAL_NOW = new Date("2026-08-24T12:00:00.000Z");

export interface TriageRegressionFixture {
  id: string;
  title: string;
  messages: TriageFeatureMessage[];
  context?: Array<{ kind: "service" | "relationship" | "project" | "account"; id: string; description: string }>;
  expected: {
    domain: ExternalTriageDecision["domain"];
    status: ExternalTriageDecision["status"];
    severity: ExternalTriageDecision["consequence"]["severity"];
    timeCriticality: ExternalTriageDecision["timeCriticality"];
    harmAccrual: ExternalTriageDecision["harmAccrual"];
    actionRequired: boolean;
    actionKind?: NonNullable<ExternalTriageDecision["action"]>["kind"];
    briefing: boolean;
    band: PriorityBand;
    lane: PriorityLane;
    safeActionTarget?: boolean;
  };
  expectedEventCount?: number;
}

function mail(
  id: string,
  from: string,
  subject: string,
  textBody: string,
  options: Partial<TriageFeatureMessage> = {}
): TriageFeatureMessage {
  return {
    providerMessageId: id,
    from: { address: from },
    subject,
    textBody,
    receivedAt: "2026-08-24T11:55:00.000Z",
    headers: {},
    flags: { automated: true, bulk: false, hasListUnsubscribe: false },
    ...options,
  };
}

const expected = (
  domain: TriageRegressionFixture["expected"]["domain"],
  severity: TriageRegressionFixture["expected"]["severity"],
  timeCriticality: TriageRegressionFixture["expected"]["timeCriticality"],
  harmAccrual: TriageRegressionFixture["expected"]["harmAccrual"],
  actionRequired: boolean,
  briefing: boolean,
  band: PriorityBand,
  lane: PriorityLane,
  extra: Partial<TriageRegressionFixture["expected"]> = {}
): TriageRegressionFixture["expected"] => ({
  domain,
  status: "open",
  severity,
  timeCriticality,
  harmAccrual,
  actionRequired,
  ...(actionRequired ? { actionKind: "review" } : {}),
  briefing,
  band,
  lane,
  ...extra,
});

export const TRIAGE_REGRESSION_FIXTURES: TriageRegressionFixture[] = [
  {
    id: "adaflow-payment-failed",
    title: "Adaflow failed recurring payment",
    messages: [mail("ada-1", "billing@adaflow.com", "Recurring payment failed", "Payment failed for 297 BRL on subscription sub_adaflow.")],
    context: [{ kind: "service", id: "adaflow-production", description: "Production dependency" }],
    expected: expected("financial", "major", "today", "latent", true, true, "P1", "action", { actionKind: "pay" }),
  },
  {
    id: "adaflow-duplicate",
    title: "Duplicate Adaflow failure from payment processor",
    messages: [
      mail("ada-2a", "billing@adaflow.com", "Recurring payment failed", "Payment failed for subscription sub_adaflow.", { providerThreadId: "adaflow-incident" }),
      mail("ada-2b", "processor@adaflow.com", "Payment failure notice", "Payment failed for subscription sub_adaflow.", { providerThreadId: "adaflow-incident" }),
    ],
    expected: expected("financial", "major", "today", "latent", true, true, "P1", "action", { actionKind: "pay" }),
  },
  {
    id: "jira-overdue",
    title: "Jira overdue work",
    messages: [mail("jira-1", "jira@atlassian.com", "SKAFE-123 overdue", "Issue SKAFE-123 is overdue and due today.")],
    expected: expected("work", "moderate", "today", "latent", true, true, "P2", "action"),
  },
  {
    id: "gsc-5xx",
    title: "Google Search Console 5xx",
    messages: [mail("gsc-1", "search-console-noreply@google.com", "HTTP 5xx errors", "HTTP 503 responses detected on mailscribe.app.")],
    context: [{ kind: "service", id: "mailscribe-production", description: "Production website" }],
    expected: expected("infrastructure", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate" }),
  },
  {
    id: "cloudflare-certificate",
    title: "Cloudflare certificate activity",
    messages: [mail("cf-1", "notify@cloudflare.com", "Certificate activity", "A certificate was issued for mailscribe.app.")],
    expected: expected("infrastructure", "moderate", "this_week", "none", false, true, "P2", "briefing"),
  },
  {
    id: "assessment-deadline",
    title: "Technical assessment deadline",
    messages: [mail("assessment-1", "hiring@example.com", "Technical assessment", "Please submit the assessment by August 25, 2026.")],
    expected: expected("work", "major", "today", "latent", true, true, "P1", "action", { actionKind: "review" }),
  },
  {
    id: "oauth-expected",
    title: "Expected OAuth grant",
    messages: [mail("oauth-1", "accounts-noreply@google.com", "Application access granted", "OAuth access was granted to the application you just connected.")],
    context: [{ kind: "account", id: "google-primary", description: "User initiated connection" }],
    expected: expected("security", "minor", "none", "none", false, false, "P3", "record"),
  },
  {
    id: "oauth-unexpected",
    title: "Unexpected OAuth grant",
    messages: [mail("oauth-2", "accounts-noreply@google.com", "Application access granted", "OAuth access was granted to Unknown Sync Tool.")],
    expected: expected("security", "major", "now", "active", true, true, "P0", "action", { actionKind: "revoke" }),
  },
  {
    id: "railway-upgrade",
    title: "Railway Postgres upgrade",
    messages: [mail("railway-1", "notify@railway.app", "Postgres upgraded", "Your Postgres database was automatically upgraded successfully.")],
    expected: expected("infrastructure", "minor", "none", "none", false, true, "P3", "briefing"),
  },
  {
    id: "verification-live",
    title: "Live verification code",
    messages: [mail("otp-1", "login@example.com", "Verification code 849201", "Your verification code is 849201 and expires in 10 minutes.")],
    expected: expected("account", "moderate", "now", "latent", true, false, "P2", "action", { actionKind: "verify" }),
  },
  {
    id: "verification-expired",
    title: "Expired verification code",
    messages: [mail("otp-2", "login@example.com", "Verification code 849201", "Your verification code is 849201 and expires in 10 minutes.", { receivedAt: "2026-08-24T10:00:00.000Z" })],
    expected: expected("account", "none", "expired", "none", false, false, "noise", "suppressed", { status: "expired", safeActionTarget: false }),
  },
  {
    id: "login-suspicious",
    title: "Suspicious login",
    messages: [mail("login-1", "security@example.com", "New login", "New login from an unrecognized device in another country.")],
    expected: expected("security", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate" }),
  },
  {
    id: "login-expected",
    title: "Expected login",
    messages: [mail("login-2", "security@example.com", "New login", "New login from the device you just registered.")],
    context: [{ kind: "account", id: "expected-device", description: "User just signed in" }],
    expected: expected("security", "none", "none", "none", false, false, "noise", "suppressed"),
  },
  {
    id: "marketing-aggressive",
    title: "Aggressive marketing",
    messages: [mail("marketing-1", "offers@shop.example", "URGENT! 50% OFF TODAY", "Payment sale ends today. Buy now!", { headers: { "List-Unsubscribe": "<mailto:leave@shop.example>" }, flags: { automated: true, bulk: true, hasListUnsubscribe: true } })],
    expected: expected("marketing", "none", "today", "none", false, false, "noise", "suppressed"),
  },
  {
    id: "substack-expired",
    title: "Expired Substack code",
    messages: [mail("substack-1", "no-reply@substack.com", "Login code 849201", "Your login code is 849201 and expires in 10 minutes.", { receivedAt: "2026-08-24T08:00:00.000Z" })],
    expected: expected("account", "none", "expired", "none", false, false, "noise", "suppressed", { status: "expired", safeActionTarget: false }),
  },
  {
    id: "stripe-invoice-paid",
    title: "Stripe invoice paid",
    messages: [mail("stripe-1", "notify@stripe.com", "Invoice paid", "Invoice in_123 was paid successfully.")],
    expected: expected("financial", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
  {
    id: "stripe-payout-failed",
    title: "Stripe payout failed",
    messages: [mail("stripe-2", "notify@stripe.com", "Payout failed", "Payout failed for your business account.")],
    expected: expected("financial", "major", "today", "latent", true, true, "P1", "action", { actionKind: "investigate" }),
  },
  {
    id: "github-pr-lifecycle",
    title: "GitHub PR lifecycle",
    messages: [
      mail("gh-1", "notifications@github.com", "PR #52 opened", "GitHub pull request #52 opened in foxdev/mailwarden."),
      mail("gh-2", "notifications@github.com", "PR #52 updated", "GitHub pull request #52 updated in foxdev/mailwarden."),
      mail("gh-3", "notifications@github.com", "PR #52 merged", "GitHub pull request #52 merged in foxdev/mailwarden."),
    ],
    expected: expected("work", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
  {
    id: "github-changes-requested",
    title: "GitHub requested changes",
    messages: [mail("gh-4", "notifications@github.com", "Changes requested on PR #53", "Changes were requested on GitHub pull request #53 in foxdev/mailwarden.")],
    expected: expected("work", "moderate", "this_week", "latent", true, true, "P2", "action", { actionKind: "review" }),
  },
  {
    id: "domain-expiring",
    title: "Domain expiring",
    messages: [mail("domain-1", "renewals@registrar.example", "Domain expiring", "Domain mailscribe.app is expiring tomorrow.")],
    expected: expected("infrastructure", "major", "today", "latent", true, true, "P1", "action", { actionKind: "renew" }),
  },
  {
    id: "subscription-far-future",
    title: "Far-future subscription expiration",
    messages: [mail("sub-1", "billing@vendor.example", "Subscription expiration", "Subscription expires in eleven months.")],
    expected: expected("financial", "minor", "this_month", "latent", false, false, "P3", "record"),
  },
  {
    id: "subscription-production-tomorrow",
    title: "Production subscription expires tomorrow",
    messages: [mail("sub-2", "billing@vendor.example", "Subscription expires tomorrow", "Production subscription sub_prod expires tomorrow.")],
    context: [{ kind: "service", id: "production-subscription", description: "Production dependency" }],
    expected: expected("financial", "major", "today", "latent", true, true, "P1", "action", { actionKind: "renew" }),
  },
  {
    id: "airbnb-old",
    title: "Old Airbnb stay",
    messages: [mail("airbnb-1", "automated@airbnb.com", "Your stay receipt", "Receipt for your completed stay.", { receivedAt: "2026-06-01T12:00:00.000Z" })],
    expected: expected("logistics", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
  {
    id: "client-question",
    title: "Active client question",
    messages: [mail("client-1", "ana@client.example", "Launch approval question", "Could you confirm the production launch today?")],
    context: [{ kind: "relationship", id: "ana-client", description: "Active client contact" }],
    expected: expected("client", "major", "today", "latent", true, true, "P1", "action", { actionKind: "reply" }),
  },
  {
    id: "waiting-client",
    title: "User waiting on client response",
    messages: [mail("client-2", "owner@example.com", "Re: Launch approval", "I sent the requested approval and am waiting for your response.")],
    context: [{ kind: "relationship", id: "active-client", description: "Active client thread" }],
    expected: expected("client", "moderate", "this_week", "latent", false, true, "P2", "briefing"),
  },
  {
    id: "phishing-lookalike",
    title: "Phishing lookalike sender",
    messages: [mail("phish-1", "security@paypa1.example", "New login", "New login from an unrecognized device. Verify your account.", { headers: { "Authentication-Results": "spf=fail; dkim=fail; dmarc=fail" } })],
    expected: expected("security", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate", safeActionTarget: false }),
  },
  {
    id: "calendar-conflict",
    title: "Calendar conflict",
    messages: [mail("calendar-1", "calendar@example.com", "Meeting conflict", "Two meetings overlap today at 15:00.")],
    expected: expected("work", "moderate", "today", "latent", true, true, "P2", "action", { actionKind: "schedule" }),
  },
  {
    id: "invoice-not-due",
    title: "Invoice available but not due",
    messages: [mail("invoice-1", "billing@vendor.example", "Invoice available", "Invoice in_456 is available. No payment is due yet.")],
    expected: expected("financial", "minor", "this_month", "latent", false, false, "P3", "record"),
  },
  {
    id: "staging-deploy-failed",
    title: "Failed CI deployment on staging",
    messages: [mail("ci-1", "ci@github.com", "Deployment failed", "Deployment failed on staging for commit abc123.")],
    context: [{ kind: "service", id: "staging", description: "Non-production environment" }],
    expected: expected("infrastructure", "minor", "today", "latent", true, false, "P2", "action", { actionKind: "investigate" }),
  },
  {
    id: "production-deploy-failed",
    title: "Failed production deployment",
    messages: [mail("ci-2", "ci@github.com", "Deployment failed", "Deployment failed on production for commit def456.")],
    context: [{ kind: "service", id: "production", description: "Live production environment" }],
    expected: expected("infrastructure", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate" }),
  },
  {
    id: "support-auto-closed",
    title: "Customer support ticket auto-closed",
    messages: [mail("support-1", "support@example.com", "Ticket #881 auto-closed", "Customer support ticket #881 was auto-closed while awaiting your reply.")],
    expected: expected("client", "moderate", "today", "latent", true, true, "P2", "action", { actionKind: "review" }),
  },
  {
    id: "support-reopened",
    title: "Customer reopens ticket",
    messages: [mail("support-2", "support@example.com", "Ticket #881 reopened", "The customer reopened ticket #881 with a new question.")],
    expected: expected("client", "major", "today", "latent", true, true, "P1", "action", { actionKind: "reply" }),
  },
  {
    id: "password-user",
    title: "Account password changed by user",
    messages: [mail("password-1", "security@example.com", "Password changed", "Your password was changed after your settings request.")],
    context: [{ kind: "account", id: "password-change-request", description: "User initiated change" }],
    expected: expected("security", "none", "none", "none", false, false, "noise", "suppressed"),
  },
  {
    id: "password-unexpected",
    title: "Account password changed unexpectedly",
    messages: [mail("password-2", "security@example.com", "Password changed", "Your password was changed. If this was not you, secure your account.")],
    expected: expected("security", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate" }),
  },
  {
    id: "newsletter-payment",
    title: "Newsletter mentioning payment",
    messages: [mail("newsletter-1", "news@example.com", "Weekly fintech news", "This week's article discusses payment trends.", { headers: { "List-Unsubscribe": "<mailto:leave@example.com>" }, flags: { automated: true, bulk: true, hasListUnsubscribe: true } })],
    expected: expected("informational", "none", "none", "none", false, false, "noise", "suppressed"),
  },
  {
    id: "receipt-after-failure",
    title: "Receipt for previously failed payment",
    messages: [
      mail("receipt-1", "billing@vendor.example", "Payment failed", "Payment failed for subscription sub_recovered."),
      mail("receipt-2", "billing@vendor.example", "Payment succeeded", "Payment succeeded for subscription sub_recovered. Receipt attached."),
    ],
    expected: expected("financial", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
  {
    id: "security-duplicates",
    title: "Duplicate security alerts from same event",
    messages: [
      mail("security-1", "security@example.com", "New login", "New login from an unrecognized device.", { providerThreadId: "security-incident" }),
      mail("security-2", "security@example.com", "Duplicate new login alert", "New login from an unrecognized device.", { providerThreadId: "security-incident" }),
    ],
    expected: expected("security", "major", "now", "active", true, true, "P0", "action", { actionKind: "investigate" }),
  },
  {
    id: "client-bulk",
    title: "Legitimate bulk email from active client",
    messages: [mail("client-bulk-1", "updates@client.example", "Project launch update", "Please review the client launch plan this week.", { headers: { "List-Unsubscribe": "<mailto:leave@client.example>" }, flags: { automated: true, bulk: true, hasListUnsubscribe: true } })],
    context: [{ kind: "relationship", id: "bulk-client", description: "Active client communication channel" }],
    expected: expected("client", "moderate", "this_week", "latent", true, true, "P2", "action", { actionKind: "review" }),
  },
  {
    id: "outage-resolved",
    title: "Server outage resolved automatically",
    messages: [mail("outage-1", "status@example.com", "Service outage resolved", "The service outage was resolved automatically.")],
    expected: expected("infrastructure", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
  {
    id: "domain-renewed",
    title: "Domain renewed successfully",
    messages: [mail("domain-2", "renewals@registrar.example", "Domain renewed", "Domain mailscribe.app was renewed successfully.")],
    expected: expected("infrastructure", "none", "none", "none", false, false, "noise", "suppressed", { status: "resolved" }),
  },
];
