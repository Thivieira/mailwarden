import {
  CONSEQUENCE_SEVERITIES,
  HARM_ACCRUAL_STATES,
  TIME_CRITICALITIES,
  TRIAGE_STATUSES,
  type ExternalTriageDecision,
} from "@mailwarden/triage-contract";
import type { TriageFacts } from "@mailwarden/triage-features";

export const PRIORITY_BANDS = ["P0", "P1", "P2", "P3", "noise"] as const;
export type PriorityBand = typeof PRIORITY_BANDS[number];
export type PriorityLane = "action" | "briefing" | "record" | "suppressed";
export type PriorityUrgency = "immediate" | "today" | "soon" | "later" | "none" | "expired";

type Severity = typeof CONSEQUENCE_SEVERITIES[number];
type TimeCriticality = typeof TIME_CRITICALITIES[number];
type HarmAccrual = typeof HARM_ACCRUAL_STATES[number];
type Status = typeof TRIAGE_STATUSES[number];

export interface PriorityAxes {
  severity: Severity;
  timeCriticality: TimeCriticality;
  harmAccrual: HarmAccrual;
  status: Status;
}

export interface DerivedPriority {
  band: PriorityBand;
  urgency: PriorityUrgency;
  inconsistent: boolean;
}

const BASE_BANDS: Record<Severity, Record<TimeCriticality, PriorityBand>> = {
  none: { expired: "noise", now: "noise", today: "noise", this_week: "noise", this_month: "noise", none: "noise" },
  minor: { expired: "noise", now: "P2", today: "P2", this_week: "P3", this_month: "P3", none: "P3" },
  moderate: { expired: "noise", now: "P2", today: "P2", this_week: "P2", this_month: "P3", none: "P3" },
  major: { expired: "noise", now: "P1", today: "P1", this_week: "P2", this_month: "P2", none: "P2" },
  severe: { expired: "noise", now: "P0", today: "P1", this_week: "P1", this_month: "P2", none: "P2" },
};

const HARM_ADJUSTMENTS: Record<PriorityBand, Record<HarmAccrual, PriorityBand>> = {
  P0: { active: "P0", latent: "P0", none: "P0" },
  P1: { active: "P0", latent: "P1", none: "P1" },
  P2: { active: "P1", latent: "P2", none: "P2" },
  P3: { active: "P2", latent: "P3", none: "P3" },
  noise: { active: "noise", latent: "noise", none: "noise" },
};

const URGENCY: Record<TimeCriticality, PriorityUrgency> = {
  expired: "expired",
  now: "immediate",
  today: "today",
  this_week: "soon",
  this_month: "later",
  none: "none",
};

export function priorityKey(axes: PriorityAxes): string {
  return `${axes.status}|${axes.severity}|${axes.timeCriticality}|${axes.harmAccrual}`;
}

function buildPriorityTable(): Readonly<Record<string, DerivedPriority>> {
  const table: Record<string, DerivedPriority> = {};
  for (const status of TRIAGE_STATUSES) {
    for (const severity of CONSEQUENCE_SEVERITIES) {
      for (const timeCriticality of TIME_CRITICALITIES) {
        for (const harmAccrual of HARM_ACCRUAL_STATES) {
          const terminal = status === "resolved" || status === "expired" || status === "superseded";
          const inconsistent =
            (terminal && (harmAccrual === "active" || timeCriticality === "now" || timeCriticality === "today")) ||
            (severity === "none" && harmAccrual !== "none") ||
            (timeCriticality === "expired" && status !== "expired");
          table[priorityKey({ status, severity, timeCriticality, harmAccrual })] = Object.freeze({
            band: terminal ? "noise" : HARM_ADJUSTMENTS[BASE_BANDS[severity][timeCriticality]][harmAccrual],
            urgency: terminal ? (status === "expired" ? "expired" : "none") : URGENCY[timeCriticality],
            inconsistent,
          });
        }
      }
    }
  }
  return Object.freeze(table);
}

export const PRIORITY_TABLE = buildPriorityTable();

export function derivePriority(axes: PriorityAxes): DerivedPriority {
  return PRIORITY_TABLE[priorityKey(axes)]!;
}

export function deriveLane(input: Pick<ExternalTriageDecision, "actionRequired" | "briefing">, band: PriorityBand): PriorityLane {
  if (band === "noise") return "suppressed";
  if (input.actionRequired) return "action";
  if (input.briefing.include) return "briefing";
  return "record";
}

export interface AppliedClamp {
  id: string;
  effect: "floor" | "ceiling" | "review" | "remove_action_target";
  from?: PriorityBand;
  to?: PriorityBand;
}

export interface TriagePresentation extends DerivedPriority {
  lane: PriorityLane;
  safeActionTarget: boolean;
  reviewFlags: string[];
  clampsApplied: AppliedClamp[];
}

export interface PolicyResult {
  judgment: ExternalTriageDecision;
  presentation: TriagePresentation;
}

const BAND_RANK: Record<PriorityBand, number> = { P0: 0, P1: 1, P2: 2, P3: 3, noise: 4 };

function floor(current: PriorityBand, minimum: PriorityBand): PriorityBand {
  return BAND_RANK[current] > BAND_RANK[minimum] ? minimum : current;
}

function ceiling(current: PriorityBand, maximum: PriorityBand): PriorityBand {
  return BAND_RANK[current] < BAND_RANK[maximum] ? maximum : current;
}

export function applyPolicyClamps(
  decision: ExternalTriageDecision,
  facts: TriageFacts,
  constraints: { observedState?: "active" | "resolved" } = {}
): PolicyResult {
  const derived = derivePriority({
    severity: decision.consequence.severity,
    timeCriticality: decision.timeCriticality,
    harmAccrual: decision.harmAccrual,
    status: decision.status,
  });
  let band = derived.band;
  let urgency = derived.urgency;
  let safeActionTarget = true;
  const reviewFlags: string[] = [];
  const clampsApplied: AppliedClamp[] = [];
  const changeBand = (id: string, effect: "floor" | "ceiling", next: PriorityBand) => {
    if (next === band) return;
    clampsApplied.push({ id, effect, from: band, to: next });
    band = next;
  };

  const expiredCredential = facts.credentials.some((fact) => fact.value.expirationState === "expired");
  if (expiredCredential) {
    changeBand("expired_credential", "ceiling", ceiling(band, "noise"));
    urgency = "expired";
    safeActionTarget = false;
    clampsApplied.push({ id: "expired_credential", effect: "remove_action_target" });
  }

  const hasFailedPayment = facts.paymentEvents.some((fact) => fact.value === "payment_failed" || fact.value === "payout_failed");
  if (hasFailedPayment && (decision.consequence.severity === "major" || decision.consequence.severity === "severe")) {
    changeBand("verified_failed_payment", "floor", floor(band, "P1"));
  }

  const detectedSecurity = facts.securityEvents.length > 0;
  if (detectedSecurity && (decision.consequence.severity === "major" || decision.consequence.severity === "severe")) {
    changeBand("detected_security_event", "floor", floor(band, "P1"));
  }

  const nearExpiry = facts.infrastructureEvents.some((fact) => fact.value === "domain_expiry" || fact.value === "certificate_expiry") &&
    (decision.timeCriticality === "now" || decision.timeCriticality === "today");
  if (nearExpiry) changeBand("near_infrastructure_expiry", "floor", floor(band, "P1"));

  if (decision.domain === "marketing" && (facts.delivery.bulk === true || facts.delivery.listUnsubscribe)) {
    changeBand("marketing_ceiling", "ceiling", ceiling(band, "P3"));
  }

  const failedAuthentication = facts.auth.dmarc === "fail" || facts.auth.spf === "fail";
  if (failedAuthentication && detectedSecurity) {
    safeActionTarget = false;
    reviewFlags.push("sender_authentication_failed");
    clampsApplied.push({ id: "probable_phishing", effect: "review" });
    clampsApplied.push({ id: "probable_phishing", effect: "remove_action_target" });
  }

  // Trusted terminal state is the final presentation constraint; no earlier
  // safety floor may resurrect an event that deterministic evidence resolved.
  if (constraints.observedState === "resolved") {
    changeBand("observed_event_resolved", "ceiling", ceiling(band, "noise"));
    urgency = "none";
  }

  return {
    judgment: decision,
    presentation: {
      band,
      urgency,
      inconsistent: derived.inconsistent,
      lane: deriveLane(decision, band),
      safeActionTarget,
      reviewFlags,
      clampsApplied,
    },
  };
}
