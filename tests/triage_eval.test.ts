import { describe, expect, it } from "bun:test";
import { expectedDecision, evaluateFixture, runEvaluation } from "../scripts/triage-eval";
import { TRIAGE_REGRESSION_FIXTURES } from "./fixtures/triage-regression";

describe("external-agent triage evaluation", () => {
  it("keeps the permanent corpus at forty realistic cases", () => {
    expect(TRIAGE_REGRESSION_FIXTURES).toHaveLength(40);
  });

  it("passes expected semantic axes, deterministic presentation, and event clustering through production code", () => {
    const report = runEvaluation({});
    expect(report.semanticMatches).toBe(40);
    expect(report.presentationMatches).toBe(40);
    expect(report.highPriorityMisses).toBe(0);
    expect(report.marketingFalsePositives).toBe(0);
    expect(report.securityMisses).toBe(0);
    expect(report.financialMisses).toBe(0);
    expect(report.eventMergeErrors).toBe(0);
    expect(report.contractValidationFailures).toBe(0);
  });

  it("detects a valid but semantically wrong external judgment", () => {
    const fixture = TRIAGE_REGRESSION_FIXTURES.find((item) => item.id === "oauth-unexpected")!;
    const wrong = expectedDecision(fixture);
    wrong.consequence.severity = "none";
    wrong.timeCriticality = "none";
    wrong.harmAccrual = "none";
    wrong.actionRequired = false;
    wrong.actor = "nobody";
    wrong.waitingOn = "none";
    delete wrong.action;
    const result = evaluateFixture(fixture, wrong);
    expect(result.contractValid).toBe(true);
    expect(result.semanticMatch).toBe(false);
    expect(result.presentationMatch).toBe(false);
  });

  it("contains near-identical cases with opposite expected judgment", () => {
    const byId = new Map(TRIAGE_REGRESSION_FIXTURES.map((fixture) => [fixture.id, fixture]));
    const pairs: Array<[string, string]> = [
      ["oauth-expected", "oauth-unexpected"],
      ["login-expected", "login-suspicious"],
      ["staging-deploy-failed", "production-deploy-failed"],
      ["password-user", "password-unexpected"],
      ["newsletter-payment", "adaflow-payment-failed"],
    ];
    for (const [low, high] of pairs) {
      expect(byId.get(low)!.expected.band).not.toBe(byId.get(high)!.expected.band);
    }
  });
});
