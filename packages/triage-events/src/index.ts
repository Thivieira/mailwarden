import { createHash } from "node:crypto";
import type { TriageFacts } from "@mailwarden/triage-features";

export type EventKeyKind = "exact" | "thread" | "typed" | "fallback";

export interface EventKey {
  kind: EventKeyKind;
  value: string;
}

export interface EventIdentityMessage {
  accountId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId?: string | null;
  from: { address: string };
  to?: Array<{ address: string }>;
  cc?: Array<{ address: string }>;
  subject?: string | null;
  textBody?: string | null;
  headers?: Record<string, string>;
}

export interface EventIdentity {
  eventType: string;
  primaryKey: string;
  normalizedSubject: string;
  keys: EventKey[];
  observedState: "active" | "resolved";
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSubject(subject: string): string {
  return normalizeWhitespace(subject)
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .toLowerCase();
}

function headerMap(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function rfcMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  const bracketed = value.match(/<[^>]+>/g);
  return (bracketed ?? value.split(/\s+/)).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function contentHash(message: EventIdentityMessage): string {
  const canonical = JSON.stringify({
    from: message.from.address.trim().toLowerCase(),
    subject: normalizeSubject(message.subject ?? ""),
    body: normalizeWhitespace(message.textBody ?? ""),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function typedKey(message: EventIdentityMessage, facts: TriageFacts): { eventType: string; key: string } | null {
  const entity = (kind: TriageFacts["entityIds"][number]["value"]["kind"]) =>
    facts.entityIds.find((fact) => fact.value.kind === kind)?.value.id.toLowerCase();
  const jira = entity("jira_issue");
  if (jira) return { eventType: "jira_issue", key: `jira|${jira.toUpperCase()}` };

  const pr = entity("github_pr");
  const repository = entity("github_repository");
  if (pr && repository) return { eventType: "github_pr", key: `github|${repository}|pr|${pr}` };

  const invoice = entity("stripe_invoice");
  if (invoice) return { eventType: "stripe_invoice", key: `stripe|invoice|${invoice}` };
  const subscription = entity("stripe_subscription");
  if (subscription) return { eventType: "stripe_subscription", key: `stripe|subscription|${subscription}` };

  const domain = facts.entityIds.find((fact) => fact.value.kind === "domain")?.value.id.toLowerCase();
  if (domain && facts.infrastructureEvents.some((fact) => fact.value === "certificate_event" || fact.value === "certificate_expiry")) {
    return { eventType: "certificate", key: `certificate|${domain}` };
  }
  if (domain && facts.infrastructureEvents.some((fact) => fact.value === "domain_expiry" || fact.value === "domain_renewed")) {
    return { eventType: "domain", key: `domain|${domain}|expiry` };
  }
  if (domain && facts.infrastructureEvents.some((fact) => fact.value === "http_5xx")) {
    return { eventType: "http_5xx", key: `http|${domain}|5xx` };
  }

  const messageId = message.providerMessageId.trim().toLowerCase();
  return messageId ? null : { eventType: "message", key: `content|${contentHash(message)}` };
}

function observedState(message: EventIdentityMessage, facts: TriageFacts): "active" | "resolved" {
  const text = `${message.subject ?? ""}\n${message.textBody ?? ""}`;
  if (
    /\b(?:pull request|\bPR\b).{0,40}\b(?:merged|closed)\b/i.test(text) ||
    facts.paymentEvents.some((fact) => fact.value === "payment_succeeded") ||
    facts.infrastructureEvents.some((fact) => fact.value === "domain_renewed" || fact.value === "service_restored")
  ) return "resolved";
  return "active";
}

export function deriveEventIdentity(message: EventIdentityMessage, facts: TriageFacts): EventIdentity {
  const headers = headerMap(message.headers);
  const keys: EventKey[] = [
    { kind: "exact", value: `provider|${message.accountId}|${message.provider}|${message.providerMessageId}` },
    { kind: "exact", value: `content|${contentHash(message)}` },
  ];

  for (const id of rfcMessageIds(headers["message-id"])) keys.push({ kind: "exact", value: `message-id|${id}` });
  if (message.providerThreadId) {
    keys.push({ kind: "thread", value: `provider-thread|${message.accountId}|${message.providerThreadId}` });
  }
  for (const id of rfcMessageIds(`${headers["in-reply-to"] ?? ""} ${headers.references ?? ""}`)) {
    keys.push({ kind: "thread", value: `message-id|${id}` });
  }

  const typed = typedKey(message, facts);
  if (typed) keys.push({ kind: "typed", value: typed.key });

  const subject = normalizeSubject(message.subject ?? "");
  const participants = [message.from.address, ...(message.to ?? []).map((item) => item.address), ...(message.cc ?? []).map((item) => item.address)]
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (subject && participants.length > 1) {
    keys.push({ kind: "fallback", value: `subject|${message.accountId}|${subject}|${participants.join(",")}` });
  }

  const unique = [...new Map(keys.map((key) => [key.value, key])).values()];
  return {
    eventType: typed?.eventType ?? "conversation",
    primaryKey: typed?.key ?? unique.find((key) => key.kind === "thread")?.value ?? unique[0]!.value,
    normalizedSubject: subject,
    keys: unique,
    observedState: observedState(message, facts),
  };
}
