# Inbox intelligence

MailScribe core is a model-free intelligence substrate. It normalizes mailbox
truth, extracts replayable facts, reconstructs events, supplies structured
context to an external MCP client, validates the client's judgment, derives a
priority presentation, and persists the result. ChatGPT, Claude, or another MCP
client performs semantic reasoning using the user's existing AI entitlement.

```text
provider / Bridge
  -> normalized messages (L1)
  -> triage-features facts with evidence (L2)
  -> deterministic event clustering
  -> get_triage_batch over MCP
  -> external provider-neutral judgment (L3)
  -> evidence/schema validation
  -> total priority lookup and trusted-fact clamps (L4)
  -> append-only triage_decisions
  -> InboxStateService
  -> MCP, HTTP, and compatibility reads
```

## Four layers

| Layer | Owns | Must not own |
| --- | --- | --- |
| L1 observations | provider IDs, headers, normalized message/thread state | inferred consequence |
| L2 extractions | deterministic facts, ambiguity, local evidence | importance, actionability, priority |
| L3 judgments | consequence, time criticality, harm accrual, action, briefing | P0/P1/P2/P3/noise |
| L4 constraints | schema/evidence validation, clamps, lanes, priority | rewritten L3 axes |

The executable invariants live in `CLAUDE.md` and
`tests/architecture_invariants.test.ts`. In particular, extraction may never
write a judgment field, locally extracted facts require message/provider
evidence, priority mappings are total, and MailScribe core may not call a paid
inference API to maintain inbox state.

## Facts and events

`@mailwarden/triage-features` exposes `extractFeatures(message, now)`. The clock
is injected so replay is deterministic. Parsed facts include provenance and no
pseudo-probability. Credential expiry is based only on an extracted credential,
its stated or deterministic default TTL, and `message.receivedAt`; a security
category never implies an OTP.

`@mailwarden/triage-events` builds indexed identities in this order:

1. provider/RFC message identity and safe content hash;
2. provider thread graph, References/In-Reply-To, or participant-bound subject fallback;
3. typed keys such as Jira issue, GitHub PR, Stripe invoice/subscription, or domain event.

Subject or amount alone never merges messages. Message identity and search rows
remain intact. Explicit user merges use `merged_into_event_id`; merge/unmerge is
reversible and recorded in `triage_event_changes`.

## Judgment, priority, and freshness

The versioned `@mailwarden/triage-contract` contains the provider-neutral L3
shape. Evidence may reference only the exact event, message facts, and UOC
records supplied to the client. Unknown fields, client-authored priority, and
oversized or invalid values are rejected before persistence.

`@mailwarden/triage-priority` maps every status/severity/time/harm combination
through one exhaustive table. Action, briefing, record, and suppressed lanes are
separate from priority. Trusted-fact clamps alter only the persisted/current
presentation; the raw validated judgment is retained unchanged.

Decisions are append-only and store protocol, facts, and UOC versions plus the
previous decision ID. Relevant new messages, fact/UOC versions, observed status,
deadlines, and credential expiry mark a decision `needsReevaluation`; MailScribe
does not call a model automatically. `InboxStateService` recomputes current L4
presentation and is the canonical read path.

## User operating context and policy

Organizations, projects, relationships, sender profiles, accounts, services,
commitments, and preferences form a structured UOC. Its content hash is the UOC
version stored with decisions. UOC is contextual evidence, not a global rule.

Explicit message, thread, sender, domain, relationship, organization, account,
and global mailbox policies remain deterministic. The removed classifier is no
longer allowed to invent a classification merely to activate a legacy
classification-scoped policy; those policies require an externally supplied
semantic state or migration to an explicit structural scope.

## Explainability and observability

`explain_triage_state` returns stored facts, evidence references, external
rationale, referenced UOC records, clamps, priority inputs, predecessor judgment,
field changes, and event corrections. It never exposes hidden chain of thought.

`get_triage_metrics` reports privacy-safe counts for fact-bearing messages,
events, clustering, missing/stale/rejected judgments, clamps, corrections, and
reversed merges. It does not log or return message bodies or secrets.

## Compatibility window

The legacy `classifications` table is retained but receives no new ingestion
writes. `get_inbox_status`, `get_attention_queue`, `importance`, `workflowState`,
and `attentionScore` are deprecated shapes derived from the canonical event band
and lane. No compatibility reader recreates the keyword ladder.

