import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFeatures } from "../packages/triage-features/src";
import { FEATURE_FIXTURES } from "./fixtures/triage-messages";

const NOW = new Date("2026-08-24T12:08:00.000Z");
const JUDGMENT_KEYS = new Set([
  "important",
  "urgent",
  "critical",
  "needsAttention",
  "actionRequired",
  "priority",
  "briefingWorthy",
  "routine",
  "highValueClient",
  "importantSender",
  "shouldSurface",
]);

function keys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(keys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
}

describe("triage-features", () => {
  for (const fixture of FEATURE_FIXTURES) {
    it(`extracts ${fixture.name} with evidence and no judgment fields`, () => {
      const first = extractFeatures(fixture.message, NOW);
      const second = extractFeatures(fixture.message, NOW);
      expect(second).toEqual(first);
      expect(keys(first).filter((key) => JUDGMENT_KEYS.has(key))).toEqual([]);

      if (fixture.expected.payment) {
        const fact = first.paymentEvents.find((item) => item.value === fixture.expected.payment);
        expect(fact?.evidence[0]?.text).toBeTruthy();
      }
      if (fixture.expected.security) {
        const fact = first.securityEvents.find((item) => item.value === fixture.expected.security);
        expect(fact?.evidence[0]?.text).toBeTruthy();
      }
      if (fixture.expected.infrastructure) {
        const fact = first.infrastructureEvents.find((item) => item.value === fixture.expected.infrastructure);
        expect(fact?.evidence[0]?.text).toBeTruthy();
      }
      if (fixture.expected.entity) {
        const fact = first.entityIds.find((item) => item.value.id === fixture.expected.entity);
        expect(fact?.evidence[0]?.text).toBeTruthy();
      }
      if (fixture.expected.credential) {
        expect(first.credentials[0]?.value.expirationState).toBe(fixture.expected.credential);
        expect(first.credentials[0]?.evidence[0]?.text).toBeTruthy();
      }
    });
  }

  it("never turns a generic security alert into a credential", () => {
    const facts = extractFeatures({
      from: { address: "alerts@example.com" },
      subject: "Security alert",
      textBody: "We detected unusual activity from an unrecognized device.",
      receivedAt: "2026-08-24T08:00:00.000Z",
    }, NOW);
    expect(facts.securityEvents.map((fact) => fact.value)).toContain("new_login");
    expect(facts.credentials).toEqual([]);
  });

  it("has no forbidden runtime dependency or global clock access", () => {
    const source = readFileSync(join(import.meta.dir, "../packages/triage-features/src/index.ts"), "utf8");
    expect(source).not.toMatch(/from ["'](?:.*db|.*classif|.*priority|.*relationship|.*policy)/);
    expect(source).not.toContain("Date.now(");
    expect(source).not.toContain("fetch(");
  });

  it("rejects invalid replay timestamps", () => {
    expect(() => extractFeatures({
      from: { address: "sender@example.com" },
      receivedAt: "invalid",
    }, NOW)).toThrow("valid now and receivedAt");
  });
});
