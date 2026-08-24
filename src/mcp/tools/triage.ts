import { z } from "zod";
import { externalTriageDecisionSchema, TRIAGE_PROTOCOL_VERSION } from "@mailwarden/triage-contract";
import type { AuthPrincipal, PermissionScope } from "../../types/auth";
import { triageService } from "../../services/triage";

const eventId = z.string().min(1).max(200).describe("MailScribe triage event ID");
const READ_SCOPES: PermissionScope[] = ["mail.read"];
const WRITE_SCOPES: PermissionScope[] = ["profile.manage"];

export const triageTools = [
  {
    name: "get_triage_context",
    description: "Returns compact unresolved MailScribe event context for external semantic reasoning. Use this before answering what needs attention.",
    parameters: z.object({
      limit: z.number().int().min(1).max(50).default(10),
      timezone: z.string().min(1).max(100).default("UTC"),
    }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { limit: number; timezone: string }) => triageService.getTriageBatch(principal, params),
  },
  {
    name: "get_triage_batch",
    description: "Primary external-intelligence surface: bounded event facts, members, prior judgments, changes, user context, policy hints, and the exact output contract.",
    parameters: z.object({
      limit: z.number().int().min(1).max(50).default(10),
      timezone: z.string().min(1).max(100).default("UTC"),
    }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { limit: number; timezone: string }) => triageService.getTriageBatch(principal, params),
  },
  {
    name: "get_event",
    description: "Returns one event with compact member metadata, extracted facts, and its latest persisted external judgment.",
    parameters: z.object({ eventId }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { eventId: string }) => triageService.getEventContext(principal, params.eventId),
  },
  {
    name: "get_event_context",
    description: "Retrieves one event's structured context. Set includeBody only when the compact facts and snippets are insufficient.",
    parameters: z.object({ eventId, includeBody: z.boolean().default(false) }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { eventId: string; includeBody: boolean }) => triageService.getEventContext(principal, params.eventId, params.includeBody),
  },
  {
    name: "get_user_operating_context",
    description: "Returns structured organizations, projects, relationships, senders, and account roles available as context for triage judgment.",
    parameters: z.object({}),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal) => triageService.getUserOperatingContext(principal),
  },
  {
    name: "get_briefing_candidates",
    description: "Returns latest persisted decisions in the non-actionable briefing lane.",
    parameters: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { limit: number }) => triageService.getBriefingCandidates(principal, params.limit),
  },
  {
    name: "explain_triage_state",
    description: "Explains one event from stored facts, evidence references, external rationale, clamps, and deterministic priority inputs. Never returns hidden chain of thought.",
    parameters: z.object({ eventId }),
    requiredScopes: READ_SCOPES,
    handler: (principal: AuthPrincipal, params: { eventId: string }) => triageService.explain(principal, params.eventId),
  },
  {
    name: "save_triage_decisions",
    description: `Validates and appends protocol ${TRIAGE_PROTOCOL_VERSION} external judgments, verifies every evidence reference, applies L4 clamps, derives priority, and audits persistence. Never supply a priority band or score.`,
    parameters: z.object({
      decisions: z.array(externalTriageDecisionSchema).min(1).max(25),
      clientMetadata: z.object({
        name: z.string().trim().min(1).max(100).optional(),
        version: z.string().trim().min(1).max(100).optional(),
      }).strict().optional(),
    }).strict(),
    requiredScopes: WRITE_SCOPES,
    handler: (principal: AuthPrincipal, params: { decisions: unknown[]; clientMetadata?: { name?: string; version?: string } }) =>
      triageService.saveDecisions(principal, params.decisions, { clientMetadata: params.clientMetadata }),
  },
  {
    name: "correct_triage_decision",
    description: "Appends an explicit semantic correction for one event while preserving decision history. Use only from clear user intent; do not turn it into a global rule.",
    parameters: z.object({
      decision: externalTriageDecisionSchema,
      reason: z.string().trim().min(1).max(500),
    }).strict(),
    requiredScopes: WRITE_SCOPES,
    handler: (principal: AuthPrincipal, params: { decision: unknown; reason: string }) =>
      triageService.saveDecisions(principal, [params.decision], { source: "user_correction", correctionReason: params.reason }),
  },
];
