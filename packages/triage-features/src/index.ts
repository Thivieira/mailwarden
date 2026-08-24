export const TRIAGE_FEATURE_VERSION = "1";

export type EvidenceSource = "provider" | "header" | "subject" | "body" | "thread";
export type ExtractionMethod = "provider" | "structured_header" | "parser" | "regex" | "derived";

export interface FactEvidence {
  source: EvidenceSource;
  text?: string;
  start?: number;
  end?: number;
}

export interface ExtractedFact<T> {
  value: T;
  method: ExtractionMethod;
  evidence: FactEvidence[];
}

export interface TriageFeatureMessage {
  providerMessageId?: string;
  providerThreadId?: string | null;
  from: { address: string };
  subject?: string | null;
  textBody?: string | null;
  receivedAt: Date | string;
  headers?: Record<string, string>;
  flags?: {
    automated?: boolean;
    bulk?: boolean;
    hasListUnsubscribe?: boolean;
  };
}

export type ExtractedAmount = ExtractedFact<{
  amount: string;
  currency: "BRL" | "USD" | "EUR" | "GBP" | "unknown";
}>;

export type ExtractedEntityId = ExtractedFact<{
  kind: "jira_issue" | "github_pr" | "github_repository" | "stripe_invoice" | "stripe_subscription" | "domain";
  id: string;
}>;

export type ExtractedDeadline = ExtractedFact<{
  stated: string;
  at?: string;
  temporalState: "future" | "past" | "unknown";
}>;

export type ExtractedCredential = ExtractedFact<{
  kind: "verification_code";
  valuePresent: boolean;
  statedTtlSeconds: number | null;
  expiresAt: string;
  expirationState: "valid" | "expired" | "unknown";
  ttlSource: "stated" | "assumed";
}>;

export type ExtractedError = ExtractedFact<{
  kind: "http_status" | "http_5xx" | "database" | "deployment" | "service";
  code?: string;
}>;

export type PaymentEventKind =
  | "payment_failed"
  | "payment_succeeded"
  | "payment_due"
  | "refund"
  | "charge_dispute"
  | "payout_failed";

export type SecurityEventKind =
  | "oauth_grant"
  | "new_login"
  | "password_reset"
  | "password_change"
  | "mfa_change"
  | "recovery_change"
  | "certificate_change";

export type InfrastructureEventKind =
  | "http_5xx"
  | "deployment_failed"
  | "database_upgraded"
  | "certificate_event"
  | "domain_expiry"
  | "domain_renewed"
  | "certificate_expiry"
  | "service_outage"
  | "service_restored";

export interface TriageFacts {
  featureVersion: string;
  sender: {
    address: string;
    domain: string | null;
  };
  delivery: {
    automated: boolean | null;
    bulk: boolean | null;
    listUnsubscribe: boolean;
  };
  auth: {
    spf: "pass" | "fail" | "unknown";
    dkim: "pass" | "fail" | "unknown";
    dmarc: "pass" | "fail" | "unknown";
  };
  amounts: ExtractedAmount[];
  entityIds: ExtractedEntityId[];
  deadlines: ExtractedDeadline[];
  credentials: ExtractedCredential[];
  errors: ExtractedError[];
  paymentEvents: Array<ExtractedFact<PaymentEventKind>>;
  securityEvents: Array<ExtractedFact<SecurityEventKind>>;
  infrastructureEvents: Array<ExtractedFact<InfrastructureEventKind>>;
}

interface SearchSurface {
  source: "subject" | "body";
  text: string;
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function evidence(surface: SearchSurface, match: RegExpExecArray): FactEvidence {
  return {
    source: surface.source,
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  };
}

function matches(surfaces: SearchSurface[], pattern: RegExp): Array<{ surface: SearchSurface; match: RegExpExecArray }> {
  const found: Array<{ surface: SearchSurface; match: RegExpExecArray }> = [];
  for (const surface of surfaces) {
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of surface.text.matchAll(regex)) found.push({ surface, match });
  }
  return found;
}

function uniqueFacts<T>(facts: Array<ExtractedFact<T>>): Array<ExtractedFact<T>> {
  const seen = new Set<string>();
  return facts.filter((item) => {
    const key = JSON.stringify([item.value, item.evidence[0]?.source, item.evidence[0]?.start]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enumFacts<T>(
  surfaces: SearchSurface[],
  definitions: ReadonlyArray<{ value: T; pattern: RegExp }>
): Array<ExtractedFact<T>> {
  return uniqueFacts(definitions.flatMap(({ value, pattern }) =>
    matches(surfaces, pattern).map(({ surface, match }) => ({
      value,
      method: "regex" as const,
      evidence: [evidence(surface, match)],
    }))
  ));
}

function parseAuth(headers: Record<string, string>, kind: "spf" | "dkim" | "dmarc"): "pass" | "fail" | "unknown" {
  const joined = Object.entries(headers)
    .filter(([key]) => key === "authentication-results" || key === `x-${kind}-result` || key === `x-${kind}`)
    .map(([, value]) => value)
    .join(";");
  const result = new RegExp(`\\b${kind}\\s*=\\s*(pass|fail)\\b`, "i").exec(joined)?.[1]?.toLowerCase();
  if (result === "pass" || result === "fail") return result;
  if (/^(pass|fail)$/i.test(joined.trim())) return joined.trim().toLowerCase() as "pass" | "fail";
  return "unknown";
}

function parseAmounts(surfaces: SearchSurface[]): ExtractedAmount[] {
  const patterns = [
    { regex: /R\$\s*([0-9][0-9.,]*)\b/gi, currency: "BRL" as const },
    { regex: /\$\s*([0-9][0-9,.]*)\b/g, currency: "USD" as const },
    { regex: /€\s*([0-9][0-9.,]*)\b/g, currency: "EUR" as const },
    { regex: /£\s*([0-9][0-9.,]*)\b/g, currency: "GBP" as const },
    { regex: /\b([0-9][0-9.,]*)\s*(BRL|USD|EUR|GBP)\b/gi, currency: null },
  ];
  const facts: ExtractedAmount[] = [];
  for (const { regex, currency } of patterns) {
    for (const { surface, match } of matches(surfaces, regex)) {
      facts.push({
        value: {
          amount: match[1]!.replace(/,(?=\d{3}(?:\D|$))/g, ""),
          currency: currency ?? (match[2]!.toUpperCase() as "BRL" | "USD" | "EUR" | "GBP"),
        },
        method: "regex",
        evidence: [evidence(surface, match)],
      });
    }
  }
  return uniqueFacts(facts);
}

function parseEntities(surfaces: SearchSurface[]): ExtractedEntityId[] {
  const facts: ExtractedEntityId[] = [];
  const add = (kind: ExtractedEntityId["value"]["kind"], pattern: RegExp, group = 0) => {
    for (const { surface, match } of matches(surfaces, pattern)) {
      facts.push({
        value: { kind, id: match[group]! },
        method: "regex",
        evidence: [evidence(surface, match)],
      });
    }
  };
  add("jira_issue", /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g);
  add("stripe_invoice", /\bin_[A-Za-z0-9]+\b/g);
  add("stripe_subscription", /\bsub_[A-Za-z0-9]+\b/g);
  add("domain", /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi);
  for (const surface of surfaces) {
    if (!/github|pull request|\bPR\b/i.test(surface.text)) continue;
    for (const { match } of matches([surface], /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/g)) {
      facts.push({
        value: { kind: "github_repository", id: match[1]! },
        method: "regex",
        evidence: [evidence(surface, match)],
      });
    }
    for (const { match } of matches([surface], /(?:pull request|\bPR)\s*#(\d+)\b/gi)) {
      facts.push({
        value: { kind: "github_pr", id: match[1]! },
        method: "regex",
        evidence: [evidence(surface, match)],
      });
    }
  }
  return uniqueFacts(facts);
}

function parseDeadlineAt(stated: string, now: Date): string | undefined {
  if (/^tomorrow$/i.test(stated)) return new Date(now.getTime() + 86_400_000).toISOString();
  const iso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(stated);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))).toISOString();
  const named = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?$/.exec(stated);
  if (!named) return undefined;
  const month = MONTHS[named[1]!.toLowerCase()];
  if (month === undefined) return undefined;
  return new Date(Date.UTC(Number(named[3] ?? now.getUTCFullYear()), month, Number(named[2]))).toISOString();
}

function parseDeadlines(surfaces: SearchSurface[], now: Date): ExtractedDeadline[] {
  const pattern = /(?:deadline(?: is|:)?|due(?: on)?|by|before|expires? (?:on|at))\s+(tomorrow|today|eod|end of day|20\d{2}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?)/gi;
  return uniqueFacts(matches(surfaces, pattern).map(({ surface, match }) => {
    const stated = match[1]!;
    const at = parseDeadlineAt(stated, now);
    return {
      value: {
        stated,
        ...(at ? { at } : {}),
        temporalState: at ? (new Date(at).getTime() < now.getTime() ? "past" as const : "future" as const) : "unknown" as const,
      },
      method: "parser" as const,
      evidence: [evidence(surface, match)],
    };
  }));
}

function parseCredentials(surfaces: SearchSurface[], receivedAt: Date, now: Date): ExtractedCredential[] {
  const credentialPattern = /verification code|one[- ]time (?:password|code)|login code|confirmation code|security code|passcode/i;
  const occurrence = matches(surfaces, credentialPattern)[0];
  if (!occurrence) return [];

  const combined = surfaces.map((surface) => surface.text).join("\n");
  const valuePresent = /(?:code(?: is|:)?\s*|\b)([0-9]{4,8})\b/i.test(combined);
  const ttl = /(?:expires?|valid)(?:\s+for|\s+in)?\s+(\d+)\s*(minute|minutes|hour|hours)\b/i.exec(combined);
  const statedTtlSeconds = ttl
    ? Number(ttl[1]) * (/hour/i.test(ttl[2]!) ? 3_600 : 60)
    : null;
  const ttlSeconds = statedTtlSeconds ?? 15 * 60;
  const expiresAt = new Date(receivedAt.getTime() + ttlSeconds * 1_000);
  return [{
    value: {
      kind: "verification_code",
      valuePresent,
      statedTtlSeconds,
      expiresAt: expiresAt.toISOString(),
      expirationState: now.getTime() >= expiresAt.getTime() ? "expired" : "valid",
      ttlSource: ttl ? "stated" : "assumed",
    },
    method: "parser",
    evidence: [evidence(occurrence.surface, occurrence.match)],
  }];
}

export function extractFeatures(message: TriageFeatureMessage, nowInput: Date | string): TriageFacts {
  const now = new Date(nowInput);
  const receivedAt = new Date(message.receivedAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(receivedAt.getTime())) {
    throw new TypeError("extractFeatures requires valid now and receivedAt values");
  }

  const address = message.from.address.trim().toLowerCase();
  const domain = address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) || null : null;
  const headers = Object.fromEntries(
    Object.entries(message.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const surfaces: SearchSurface[] = [
    { source: "subject", text: message.subject ?? "" },
    { source: "body", text: message.textBody ?? "" },
  ];

  const automatedHeader = headers["auto-submitted"] === "auto-generated" || headers["x-autoreply"] === "yes";
  const bulkHeader = /^(bulk|list)$/i.test(headers.precedence ?? "");
  const listUnsubscribe = Boolean(headers["list-unsubscribe"] || headers["list-id"] || message.flags?.hasListUnsubscribe);

  const errors = enumFacts(surfaces, [
    { value: { kind: "http_5xx" as const }, pattern: /\b(?:HTTP\s*)?5xx\b/gi },
    { value: { kind: "http_status" as const, code: "5xx" }, pattern: /\bHTTP\s+5\d\d\b/gi },
    { value: { kind: "deployment" as const }, pattern: /\bdeploy(?:ment)? (?:has )?failed\b/gi },
    { value: { kind: "database" as const }, pattern: /\b(?:database|postgres|mysql) (?:error|failure|failed)\b/gi },
    { value: { kind: "service" as const }, pattern: /\b(?:service )?(?:outage|unavailable|downtime)\b/gi },
  ]);

  return {
    featureVersion: TRIAGE_FEATURE_VERSION,
    sender: { address, domain },
    delivery: {
      automated: message.flags?.automated ?? (automatedHeader ? true : null),
      bulk: message.flags?.bulk ?? (bulkHeader || listUnsubscribe ? true : null),
      listUnsubscribe,
    },
    auth: {
      spf: parseAuth(headers, "spf"),
      dkim: parseAuth(headers, "dkim"),
      dmarc: parseAuth(headers, "dmarc"),
    },
    amounts: parseAmounts(surfaces),
    entityIds: parseEntities(surfaces),
    deadlines: parseDeadlines(surfaces, now),
    credentials: parseCredentials(surfaces, receivedAt, now),
    errors,
    paymentEvents: enumFacts(surfaces, [
      { value: "payout_failed" as const, pattern: /\bpayout (?:has )?(?:failed|was unsuccessful)\b/gi },
      { value: "payment_failed" as const, pattern: /\b(?:payment|charge|card) (?:has |was )?(?:failed|declined|unsuccessful)\b/gi },
      { value: "payment_succeeded" as const, pattern: /\b(?:payment|invoice|charge) (?:has |was )?(?:paid|succeeded|successful)\b/gi },
      { value: "payment_due" as const, pattern: /\b(?:payment|invoice|amount) (?:is )?due\b/gi },
      { value: "refund" as const, pattern: /\brefund(?:ed| issued| processed)?\b/gi },
      { value: "charge_dispute" as const, pattern: /\b(?:charge )?dispute(?:d)?\b|\bchargeback\b/gi },
    ]),
    securityEvents: enumFacts(surfaces, [
      { value: "oauth_grant" as const, pattern: /\b(?:OAuth\s+)?(?:access (?:was )?granted|granted access|authorized (?:a new )?(?:app|application))\b/gi },
      { value: "new_login" as const, pattern: /\b(?:new (?:login|sign[- ]in)|login attempt|unrecognized device|signed in from)\b/gi },
      { value: "password_reset" as const, pattern: /\bpassword reset\b/gi },
      { value: "password_change" as const, pattern: /\bpassword (?:was |has been )?changed\b/gi },
      { value: "mfa_change" as const, pattern: /\b(?:MFA|multi[- ]factor authentication|2[- ]step verification) (?:was |has been )?(?:changed|enabled|disabled)\b/gi },
      { value: "recovery_change" as const, pattern: /\brecovery (?:email|phone|method) (?:was |has been )?(?:changed|added|removed)\b/gi },
      { value: "certificate_change" as const, pattern: /\bcertificate (?:was |has been )?(?:issued|changed|revoked)\b/gi },
    ]),
    infrastructureEvents: enumFacts(surfaces, [
      { value: "http_5xx" as const, pattern: /\b(?:HTTP\s*)?5(?:xx|\d\d)\b/gi },
      { value: "deployment_failed" as const, pattern: /\bdeploy(?:ment)? (?:has )?failed\b/gi },
      { value: "database_upgraded" as const, pattern: /\b(?:database|postgres|mysql) (?:was |has been |automatically )?upgraded\b/gi },
      { value: "certificate_event" as const, pattern: /\bcertificate (?:activity|issued|changed|revoked|renewed)\b/gi },
      { value: "domain_expiry" as const, pattern: /\bdomain .{0,60}\b(?:expires?|expiring|expiration)\b/gi },
      { value: "domain_renewed" as const, pattern: /\bdomain .{0,60}\brenewed\b/gi },
      { value: "certificate_expiry" as const, pattern: /\bcertificate .{0,60}\b(?:expires?|expiring|expiration)\b/gi },
      { value: "service_outage" as const, pattern: /\b(?:service )?(?:outage|unavailable|downtime)\b/gi },
      { value: "service_restored" as const, pattern: /\b(?:outage|service|incident) (?:has been |was )?(?:resolved|restored)\b/gi },
    ]),
  };
}

export function refreshTemporalFacts(facts: TriageFacts, nowInput: Date | string): TriageFacts {
  const now = new Date(nowInput);
  if (!Number.isFinite(now.getTime())) throw new TypeError("refreshTemporalFacts requires a valid now value");
  return {
    ...facts,
    deadlines: facts.deadlines.map((fact) => ({
      ...fact,
      value: {
        ...fact.value,
        temporalState: fact.value.at
          ? (new Date(fact.value.at).getTime() < now.getTime() ? "past" : "future")
          : "unknown",
      },
    })),
    credentials: facts.credentials.map((fact) => ({
      ...fact,
      value: {
        ...fact.value,
        expirationState: Number.isFinite(new Date(fact.value.expiresAt).getTime())
          ? (new Date(fact.value.expiresAt).getTime() <= now.getTime() ? "expired" : "valid")
          : "unknown",
      },
    })),
  };
}
