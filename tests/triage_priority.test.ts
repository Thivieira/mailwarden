import { describe, expect, it } from "bun:test";
import {
  CONSEQUENCE_SEVERITIES,
  HARM_ACCRUAL_STATES,
  TIME_CRITICALITIES,
  TRIAGE_PROTOCOL_VERSION,
  TRIAGE_STATUSES,
  type ExternalTriageDecision,
} from "../packages/triage-contract/src";
import { extractFeatures } from "../packages/triage-features/src";
import {
  PRIORITY_TABLE,
  applyPolicyClamps,
  deriveLane,
  derivePriority,
  type PriorityBand,
} from "../packages/triage-priority/src";

const BAND_RANK: Record<PriorityBand, number> = { P0: 0, P1: 1, P2: 2, P3: 3, noise: 4 };

function decision(overrides: Partial<ExternalTriageDecision> = {}): ExternalTriageDecision {
  return {
    protocolVersion: TRIAGE_PROTOCOL_VERSION,
    eventId: "event-1",
    domain: "financial",
    status: "open",
    consequence: { severity: "major", description: "Material consequence." },
    timeCriticality: "today",
    harmAccrual: "latent",
    actionRequired: true,
    actor: "user",
    waitingOn: "user",
    action: { kind: "pay", summary: "Update payment." },
    briefing: { include: true, line: "Payment failed." },
    rationale: "Supported by the failed payment fact.",
    evidence: [{ messageId: "message-1", factPath: "paymentEvents.0" }],
    ...overrides,
  };
}

describe("total priority derivation", () => {
  it("contains every enumerable state exactly once", () => {
    expect(Object.keys(PRIORITY_TABLE)).toHaveLength(
      TRIAGE_STATUSES.length * CONSEQUENCE_SEVERITIES.length * TIME_CRITICALITIES.length * HARM_ACCRUAL_STATES.length
    );
    for (const status of TRIAGE_STATUSES) for (const severity of CONSEQUENCE_SEVERITIES) {
      for (const timeCriticality of TIME_CRITICALITIES) for (const harmAccrual of HARM_ACCRUAL_STATES) {
        expect(derivePriority({ status, severity, timeCriticality, harmAccrual })).toBeDefined();
      }
    }
  });

  it("is monotonic by severity and urgency for non-terminal states", () => {
    const urgencyOrder = ["none", "this_month", "this_week", "today", "now"] as const;
    for (const status of ["open", "in_progress"] as const) for (const harmAccrual of HARM_ACCRUAL_STATES) {
      for (const timeCriticality of urgencyOrder) {
        const bands = CONSEQUENCE_SEVERITIES.map((severity) => BAND_RANK[derivePriority({ status, severity, timeCriticality, harmAccrual }).band]);
        for (let index = 1; index < bands.length; index++) expect(bands[index]!).toBeLessThanOrEqual(bands[index - 1]!);
      }
      for (const severity of CONSEQUENCE_SEVERITIES) {
        const bands = urgencyOrder.map((timeCriticality) => BAND_RANK[derivePriority({ status, severity, timeCriticality, harmAccrual }).band]);
        for (let index = 1; index < bands.length; index++) expect(bands[index]!).toBeLessThanOrEqual(bands[index - 1]!);
      }
    }
  });

  it("suppresses every terminal state and keeps P0 rare", () => {
    for (const status of ["resolved", "expired", "superseded"] as const) {
      for (const entry of Object.entries(PRIORITY_TABLE).filter(([key]) => key.startsWith(`${status}|`))) expect(entry[1].band).toBe("noise");
    }
    const p0 = Object.values(PRIORITY_TABLE).filter((value) => value.band === "P0").length;
    expect(p0 / Object.keys(PRIORITY_TABLE).length).toBeLessThan(0.05);
  });

  it("keeps actionability and briefing in separate lanes", () => {
    expect(deriveLane({ actionRequired: true, briefing: { include: true } }, "P2")).toBe("action");
    expect(deriveLane({ actionRequired: false, briefing: { include: true } }, "P2")).toBe("briefing");
    expect(deriveLane({ actionRequired: false, briefing: { include: false } }, "P2")).toBe("record");
    expect(deriveLane({ actionRequired: true, briefing: { include: true } }, "noise")).toBe("suppressed");
  });
});

describe("L4 policy clamps", () => {
  it("is pure and idempotent without mutating judgment axes", () => {
    const input = decision();
    const before = structuredClone(input);
    const facts = extractFeatures({ from: { address: "billing@example.com" }, subject: "Payment failed", textBody: "Payment failed for 297 BRL.", receivedAt: "2026-08-24T12:00:00.000Z" }, "2026-08-24T12:05:00.000Z");
    const first = applyPolicyClamps(input, facts);
    const second = applyPolicyClamps(input, facts);
    expect(second).toEqual(first);
    expect(input).toEqual(before);
    expect(first.judgment).toEqual(before);
    expect(first.presentation.band).toBe("P1");
  });

  it("suppresses expired credentials without treating generic security as credentials", () => {
    const expired = extractFeatures({ from: { address: "login@example.com" }, subject: "Verification code", textBody: "Code 849201 expires in 10 minutes.", receivedAt: "2026-08-24T10:00:00.000Z" }, "2026-08-24T12:00:00.000Z");
    const alert = extractFeatures({ from: { address: "security@example.com" }, subject: "Security alert", textBody: "New login from an unrecognized device.", receivedAt: "2026-08-24T10:00:00.000Z" }, "2026-08-24T12:00:00.000Z");
    expect(applyPolicyClamps(decision({ domain: "security" }), expired).presentation.band).toBe("noise");
    expect(applyPolicyClamps(decision({ domain: "security" }), alert).presentation.band).toBe("P1");
  });

  it("flags authenticated security risk and removes unsafe action targets", () => {
    const facts = extractFeatures({
      from: { address: "security@lookalike.example" },
      subject: "New login",
      textBody: "New login from an unrecognized device.",
      receivedAt: "2026-08-24T12:00:00.000Z",
      headers: { "Authentication-Results": "spf=fail; dmarc=fail; dkim=fail" },
    }, "2026-08-24T12:05:00.000Z");
    const presentation = applyPolicyClamps(decision({ domain: "security" }), facts).presentation;
    expect(presentation.safeActionTarget).toBe(false);
    expect(presentation.reviewFlags).toContain("sender_authentication_failed");
  });

  it("suppresses a deterministically resolved event without rewriting its stale judgment", () => {
    const input = decision();
    const facts = extractFeatures({ from: { address: "billing@example.com" }, subject: "Payment succeeded", textBody: "Payment succeeded.", receivedAt: "2026-08-24T12:00:00.000Z" }, "2026-08-24T12:05:00.000Z");
    const result = applyPolicyClamps(input, facts, { observedState: "resolved" });
    expect(result.presentation.band).toBe("noise");
    expect(result.judgment.status).toBe("open");
    expect(result.presentation.clampsApplied.map((clamp) => clamp.id)).toContain("observed_event_resolved");
  });
});
