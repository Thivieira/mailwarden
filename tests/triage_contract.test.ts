import { describe, expect, it } from "bun:test";
import {
  TRIAGE_PROTOCOL_VERSION,
  TriageEvidenceError,
  externalTriageDecisionSchema,
  validateExternalTriageDecision,
  type ExternalTriageDecision,
} from "../packages/triage-contract/src";

const supplied = {
  eventId: "event-1",
  factPathsByMessage: {
    "message-1": ["paymentEvents.0", "amounts.0"],
  },
  contextIds: { service: ["service-1"] },
};

const decision: ExternalTriageDecision = {
  protocolVersion: TRIAGE_PROTOCOL_VERSION,
  eventId: "event-1",
  domain: "financial",
  status: "open",
  consequence: { severity: "major", description: "Production service may stop." },
  timeCriticality: "today",
  harmAccrual: "latent",
  actionRequired: true,
  actor: "user",
  waitingOn: "user",
  action: { kind: "pay", summary: "Update the payment method." },
  briefing: { include: true, line: "Production payment failed." },
  rationale: "The supplied facts show a failed payment for a production dependency.",
  evidence: [{ messageId: "message-1", factPath: "paymentEvents.0" }],
  contextReferences: [{ kind: "service", id: "service-1" }],
};

describe("external triage contract", () => {
  it("accepts one provider-neutral decision shape", () => {
    expect(validateExternalTriageDecision(decision, supplied)).toEqual(decision);
  });

  it("rejects unknown events, messages, facts, and context", () => {
    expect(() => validateExternalTriageDecision({ ...decision, eventId: "invented" }, supplied)).toThrow(TriageEvidenceError);
    expect(() => validateExternalTriageDecision({ ...decision, evidence: [{ messageId: "invented", factPath: "paymentEvents.0" }] }, supplied)).toThrow("Unknown message id");
    expect(() => validateExternalTriageDecision({ ...decision, evidence: [{ messageId: "message-1", factPath: "invented.0" }] }, supplied)).toThrow("Fact was not supplied");
    expect(() => validateExternalTriageDecision({ ...decision, contextReferences: [{ kind: "service", id: "invented" }] }, supplied)).toThrow("Context was not supplied");
  });

  it("rejects invalid enums, oversized prose, and client-written priority", () => {
    expect(() => externalTriageDecisionSchema.parse({ ...decision, domain: "sales" })).toThrow();
    expect(() => externalTriageDecisionSchema.parse({ ...decision, rationale: "x".repeat(2_001) })).toThrow();
    expect(() => externalTriageDecisionSchema.parse({ ...decision, priority: "P0" })).toThrow();
    expect(() => externalTriageDecisionSchema.parse({ ...decision, score: Number.NaN })).toThrow();
  });

  it("enforces action and terminal-state consistency", () => {
    expect(() => externalTriageDecisionSchema.parse({ ...decision, actor: "nobody" })).toThrow("actor=user");
    expect(() => externalTriageDecisionSchema.parse({ ...decision, status: "resolved" })).toThrow("terminal");
    expect(() => externalTriageDecisionSchema.parse({ ...decision, briefing: { include: false, line: "hidden" } })).toThrow("include=true");
  });
});
