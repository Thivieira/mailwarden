# Inbox intelligence migration notes

The migration is additive and keeps provider messages, legacy classifications,
tokens, accounts, and stable machine identifiers in place.

| Migration | Adds | Rollback posture |
| --- | --- | --- |
| `0011_inbox_intelligence_events.sql` | message facts, events, keys, members | old code ignores the new tables |
| `0012_external_triage_decisions.sql` | append-only judgments/presentation | old code ignores the new table |
| `0013_structured_user_operating_context.sql` | services and commitments | old code ignores the new tables |
| `0014_triage_explainability_and_corrections.sql` | canonical merge link and correction log | nullable column/tables may remain during code rollback |

Apply D1 migrations before deploying code that reads these tables/columns. Do
not drop or rewrite historical message/classification rows during rollout.

For existing mail, run `bun run replay -- --limit <n>` in controlled batches.
Replay now upserts facts and returns an existing event membership without
incrementing its count, so it is safe to repeat. It performs no inference and
does not create L3 decisions. External clients judge replayed events later.

The new read path is `InboxStateService`. Legacy classification rows are retained
for a deprecation window but are no longer written during ingestion and are not
a fallback source of semantic truth. The `correct_classification` MCP tool was
removed; use the event correction/UOC/policy tools documented in
`MCP_TRIAGE_PROTOCOL.md`.

Rollback is code-first: restore the earlier Worker while leaving additive schema
in place. Destructive cleanup of `classifications` and deprecated response fields
must wait until downstream consumers have migrated and production evidence shows
no reads of those surfaces.

