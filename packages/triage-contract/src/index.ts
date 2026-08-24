import { z } from "zod";

export const TRIAGE_PROTOCOL_VERSION = "1";

export const TRIAGE_DOMAINS = [
  "security",
  "financial",
  "work",
  "client",
  "infrastructure",
  "account",
  "logistics",
  "personal",
  "marketing",
  "informational",
] as const;

export const TRIAGE_STATUSES = ["open", "in_progress", "resolved", "expired", "superseded"] as const;
export const CONSEQUENCE_SEVERITIES = ["none", "minor", "moderate", "major", "severe"] as const;
export const TIME_CRITICALITIES = ["expired", "now", "today", "this_week", "this_month", "none"] as const;
export const HARM_ACCRUAL_STATES = ["active", "latent", "none"] as const;

const actionSchema = z.object({
  kind: z.enum(["reply", "pay", "renew", "verify", "revoke", "investigate", "schedule", "review", "none"]),
  summary: z.string().trim().min(1).max(240),
}).strict();

const evidenceSchema = z.object({
  messageId: z.string().min(1).max(200),
  factPath: z.string().min(1).max(240),
}).strict();

export const externalTriageDecisionSchema = z.object({
  protocolVersion: z.literal(TRIAGE_PROTOCOL_VERSION),
  eventId: z.string().min(1).max(200),
  domain: z.enum(TRIAGE_DOMAINS),
  status: z.enum(TRIAGE_STATUSES),
  consequence: z.object({
    severity: z.enum(CONSEQUENCE_SEVERITIES),
    description: z.string().trim().min(1).max(500),
  }).strict(),
  timeCriticality: z.enum(TIME_CRITICALITIES),
  harmAccrual: z.enum(HARM_ACCRUAL_STATES),
  actionRequired: z.boolean(),
  actor: z.enum(["user", "someone_else", "nobody"]),
  waitingOn: z.enum(["user", "counterparty", "system", "none"]),
  action: actionSchema.optional(),
  briefing: z.object({
    include: z.boolean(),
    line: z.string().trim().min(1).max(240).optional(),
  }).strict(),
  rationale: z.string().trim().min(1).max(2_000),
  evidence: z.array(evidenceSchema).min(1).max(50),
  contextReferences: z.array(z.object({
    kind: z.enum(["organization", "project", "relationship", "sender_profile", "account", "service", "commitment", "preference"]),
    id: z.string().min(1).max(200),
  }).strict()).max(50).optional(),
}).strict().superRefine((decision, context) => {
  if (decision.actionRequired && (decision.actor !== "user" || !decision.action || decision.action.kind === "none")) {
    context.addIssue({
      code: "custom",
      path: ["actionRequired"],
      message: "actionRequired needs actor=user and a non-none action",
    });
  }
  if (["resolved", "expired", "superseded"].includes(decision.status) && decision.actionRequired) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "terminal decisions cannot require user action",
    });
  }
  if (decision.briefing.line && !decision.briefing.include) {
    context.addIssue({
      code: "custom",
      path: ["briefing", "line"],
      message: "briefing line requires include=true",
    });
  }
});

export type ExternalTriageDecision = z.infer<typeof externalTriageDecisionSchema>;

export interface SuppliedTriageEvidence {
  eventId: string;
  factPathsByMessage: Record<string, readonly string[]>;
  contextIds?: Record<string, readonly string[]>;
}

export class TriageEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriageEvidenceError";
  }
}

export function validateExternalTriageDecision(
  input: unknown,
  supplied: SuppliedTriageEvidence
): ExternalTriageDecision {
  const decision = externalTriageDecisionSchema.parse(input);
  if (decision.eventId !== supplied.eventId) {
    throw new TriageEvidenceError(`Unknown event id: ${decision.eventId}`);
  }

  for (const reference of decision.evidence) {
    const paths = supplied.factPathsByMessage[reference.messageId];
    if (!paths) throw new TriageEvidenceError(`Unknown message id: ${reference.messageId}`);
    if (!paths.includes(reference.factPath)) {
      throw new TriageEvidenceError(`Fact was not supplied: ${reference.messageId}:${reference.factPath}`);
    }
  }

  for (const reference of decision.contextReferences ?? []) {
    if (!supplied.contextIds?.[reference.kind]?.includes(reference.id)) {
      throw new TriageEvidenceError(`Context was not supplied: ${reference.kind}:${reference.id}`);
    }
  }
  return decision;
}
