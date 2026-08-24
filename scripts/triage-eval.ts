import { readFileSync } from "node:fs";
import { extractFeatures, type TriageFacts } from "@mailwarden/triage-features";
import { deriveEventIdentity } from "@mailwarden/triage-events";
import {
  TRIAGE_PROTOCOL_VERSION,
  externalTriageDecisionSchema,
  validateExternalTriageDecision,
  type ExternalTriageDecision,
} from "@mailwarden/triage-contract";
import { applyPolicyClamps } from "@mailwarden/triage-priority";
import {
  EVAL_NOW,
  TRIAGE_REGRESSION_FIXTURES,
  type TriageRegressionFixture,
} from "../tests/fixtures/triage-regression";

function paths(facts: TriageFacts): string[] {
  return Object.entries(facts).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map((_item, index) => `${key}.${index}`);
    if (value && typeof value === "object") return Object.keys(value).map((child) => `${key}.${child}`);
    return [key];
  });
}

function messageId(fixture: TriageRegressionFixture, index: number): string {
  return `${fixture.id}-message-${index + 1}`;
}

export function expectedDecision(fixture: TriageRegressionFixture): ExternalTriageDecision {
  const expected = fixture.expected;
  return {
    protocolVersion: TRIAGE_PROTOCOL_VERSION,
    eventId: fixture.id,
    domain: expected.domain,
    status: expected.status,
    consequence: { severity: expected.severity, description: `Expected consequence for ${fixture.title}.` },
    timeCriticality: expected.timeCriticality,
    harmAccrual: expected.harmAccrual,
    actionRequired: expected.actionRequired,
    actor: expected.actionRequired ? "user" : "nobody",
    waitingOn: expected.actionRequired ? "user" : "none",
    ...(expected.actionRequired ? { action: { kind: expected.actionKind ?? "review", summary: `Handle ${fixture.title}.` } } : {}),
    briefing: { include: expected.briefing, ...(expected.briefing ? { line: fixture.title } : {}) },
    rationale: `Fixture expectation based only on supplied facts and structured context for ${fixture.title}.`,
    evidence: [{ messageId: messageId(fixture, 0), factPath: "sender.domain" }],
    ...(fixture.context?.length ? { contextReferences: fixture.context.map((item) => ({ kind: item.kind, id: item.id })) } : {}),
  };
}

function clusteredEventCount(identities: ReturnType<typeof deriveEventIdentity>[]): number {
  const groups: Array<Set<string>> = [];
  for (const identity of identities) {
    const values = new Set(identity.keys.map((key) => key.value));
    const matches = groups.filter((group) => [...values].some((value) => group.has(value)));
    if (matches.length === 0) groups.push(values);
    else {
      const merged = matches[0]!;
      for (const value of values) merged.add(value);
      for (const extra of matches.slice(1)) {
        for (const value of extra) merged.add(value);
        groups.splice(groups.indexOf(extra), 1);
      }
    }
  }
  return groups.length;
}

export function buildEvalContext(fixture: TriageRegressionFixture) {
  const members = fixture.messages.map((message, index) => {
    const facts = extractFeatures(message, EVAL_NOW);
    return {
      messageId: messageId(fixture, index),
      subject: message.subject,
      receivedAt: new Date(message.receivedAt).toISOString(),
      factsVersion: facts.featureVersion,
      facts,
      factPaths: paths(facts),
    };
  });
  const identities = fixture.messages.map((message, index) => deriveEventIdentity({
    accountId: "fixture-account",
    provider: "fixture",
    providerMessageId: message.providerMessageId ?? messageId(fixture, index),
    providerThreadId: message.providerThreadId,
    from: message.from,
    subject: message.subject,
    textBody: message.textBody,
    headers: message.headers,
    to: [{ address: "user@example.com" }],
  }, members[index]!.facts));
  return {
    protocolVersion: TRIAGE_PROTOCOL_VERSION,
    currentTime: EVAL_NOW.toISOString(),
    timezone: "UTC",
    event: { id: fixture.id, title: fixture.title, identity: identities.at(-1) },
    members,
    userContext: fixture.context ?? [],
    previousJudgment: null,
    changesSinceJudgment: { firstJudgment: true, messageCount: members.length },
    policyHints: {
      detectedSecurityEvent: members.some((member) => member.facts.securityEvents.length > 0),
      failedPayment: members.some((member) => member.facts.paymentEvents.some((fact) => fact.value === "payment_failed" || fact.value === "payout_failed")),
      expiredCredential: members.some((member) => member.facts.credentials.some((fact) => fact.value.expirationState === "expired")),
    },
    validOutputContract: (externalTriageDecisionSchema as any).toJSONSchema(),
    clusteredEventCount: clusteredEventCount(identities),
  };
}

export interface FixtureEvaluation {
  fixtureId: string;
  contractValid: boolean;
  semanticMatch: boolean;
  presentationMatch: boolean;
  eventMergeMatch: boolean;
  issues: string[];
}

export function evaluateFixture(fixture: TriageRegressionFixture, input: unknown): FixtureEvaluation {
  const context = buildEvalContext(fixture);
  const issues: string[] = [];
  try {
    const decision = validateExternalTriageDecision(input, {
      eventId: fixture.id,
      factPathsByMessage: Object.fromEntries(context.members.map((member) => [member.messageId, member.factPaths])),
      contextIds: Object.fromEntries((fixture.context ?? []).map((item) => [item.kind, (fixture.context ?? []).filter((candidate) => candidate.kind === item.kind).map((candidate) => candidate.id)])),
    });
    const expected = fixture.expected;
    const semanticMatch =
      decision.domain === expected.domain &&
      decision.status === expected.status &&
      decision.consequence.severity === expected.severity &&
      decision.timeCriticality === expected.timeCriticality &&
      decision.harmAccrual === expected.harmAccrual &&
      decision.actionRequired === expected.actionRequired &&
      decision.briefing.include === expected.briefing;
    if (!semanticMatch) issues.push("semantic_axes");
    const presentation = applyPolicyClamps(decision, context.members.at(-1)!.facts).presentation;
    const presentationMatch =
      presentation.band === expected.band &&
      presentation.lane === expected.lane &&
      (expected.safeActionTarget === undefined || presentation.safeActionTarget === expected.safeActionTarget);
    if (!presentationMatch) issues.push("presentation");
    const eventMergeMatch = context.clusteredEventCount === (fixture.expectedEventCount ?? 1);
    if (!eventMergeMatch) issues.push("event_merge");
    return { fixtureId: fixture.id, contractValid: true, semanticMatch, presentationMatch, eventMergeMatch, issues };
  } catch (error: any) {
    return { fixtureId: fixture.id, contractValid: false, semanticMatch: false, presentationMatch: false, eventMergeMatch: false, issues: [`contract:${error.message}`] };
  }
}

export function runEvaluation(judgments: Record<string, unknown>) {
  const results = TRIAGE_REGRESSION_FIXTURES.map((fixture) =>
    evaluateFixture(fixture, judgments[fixture.id] ?? expectedDecision(fixture))
  );
  const expectedHigh = TRIAGE_REGRESSION_FIXTURES.filter((fixture) => fixture.expected.band === "P0" || fixture.expected.band === "P1");
  const highMisses = expectedHigh.filter((fixture) => !results.find((result) => result.fixtureId === fixture.id)?.presentationMatch).length;
  const marketingFalsePositives = TRIAGE_REGRESSION_FIXTURES.filter((fixture) => fixture.expected.domain === "marketing" && !results.find((result) => result.fixtureId === fixture.id)?.presentationMatch).length;
  const securityMisses = TRIAGE_REGRESSION_FIXTURES.filter((fixture) => fixture.expected.domain === "security" && !results.find((result) => result.fixtureId === fixture.id)?.semanticMatch).length;
  const financialMisses = TRIAGE_REGRESSION_FIXTURES.filter((fixture) => fixture.expected.domain === "financial" && !results.find((result) => result.fixtureId === fixture.id)?.semanticMatch).length;
  return {
    corpusSize: results.length,
    semanticMatches: results.filter((result) => result.semanticMatch).length,
    presentationMatches: results.filter((result) => result.presentationMatch).length,
    highPriorityMisses: highMisses,
    marketingFalsePositives,
    securityMisses,
    financialMisses,
    eventMergeErrors: results.filter((result) => !result.eventMergeMatch).length,
    contractValidationFailures: results.filter((result) => !result.contractValid).length,
    results,
  };
}

if (import.meta.main) {
  const argument = Bun.argv[2];
  if (argument === "--contexts") {
    console.log(JSON.stringify(TRIAGE_REGRESSION_FIXTURES.map(buildEvalContext), null, 2));
  } else {
    const judgments = argument ? JSON.parse(readFileSync(argument, "utf8")) : {};
    const report = runEvaluation(judgments);
    console.log(JSON.stringify(report, null, 2));
    if (report.results.some((result) => result.issues.length > 0)) process.exitCode = 1;
  }
}
