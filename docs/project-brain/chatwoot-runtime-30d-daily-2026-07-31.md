# Project Brain — Chatwoot 30-Day Durable Runtime

## Durable decision

Chatwoot Repository Runtime uses one immutable window contract:

```text
Initial UAT backfill                 = exact rolling 30 days
Automatic backfill expansion        = false
Daily incremental overlap           = exact rolling 3 days
Frequency contract                  = daily
Older-created updated Conversation  = included
Missing metric                      = null unless Source confirms zero
```

The window is anchored to Stable Queue `originalRequestedAt`, not the wall clock of a retry or continuation. This prevents retries from drifting the 30-day or three-day boundary.

## Architecture decision

Existing Chatwoot Foundation remains authoritative. Runtime orchestration is added as a bounded state machine over Shared Core:

```text
ChatwootDurableApiClient
→ existing Chatwoot normalizers
→ existing prepareChatwootAnalyticsSync
→ existing D1ChatwootAnalyticsStore
→ existing TableSyncEngine
→ existing Coverage store
→ existing D1ResumableWorkStore
→ existing D1IncrementalStateStore
→ existing runReliableSync / Lock / Queue / DLQ
```

The only new D1 component is a read-only bounded rollup source over Migration 0018 Conversation Daily facts. It is not a second writer or reliability framework.

## Pagination decision

The verified Reporting inventory contains at least 1,125 pages. The generic Provider client historically bounded pages at 1,000. The durable client extends only Account Reporting page validation to a configurable maximum of 5,000 while retaining the original GET-only transport, retry, timeout, response-size and authorization behavior.

Each Queue delivery processes one bounded unit:

- one Masters unit;
- configured Conversation pages per invocation (default 1);
- configured Reporting pages per invocation (default 5);
- one bounded 500-row rollup page;
- one final checkpoint unit.

This avoids one Worker invocation or Queue payload containing the complete backfill.

## Recovery decision

Durable phase state is PII-free. It stores only cursors, declared totals, counters and compact numeric aggregates. Raw Chatwoot payloads are normalized and written through existing Stable-key sinks before the phase advances.

Therefore:

- failure before phase commit reruns the same Stable keys;
- failure after phase commit resumes at `nextSequence`;
- duplicate/stale continuation performs no Provider or Business write;
- the final incremental checkpoint is written once after all stages;
- completed work replays its completion without another backfill.

## Daily metric decision

Per-Conversation daily facts remain the atomic date-level source. Agent, Inbox and Account daily rows are rebuilt from bounded D1 pages after all source pages are durable. Compact accumulators keep only counts, sums and non-null sample counts. A missing duration keeps count zero and materializes as `null`, never zero.

## Activation decision

Repository examples and defaults remain all false. This Workstream does not add a Chatwoot Cron producer and does not activate Webhooks. `daily` is a Runtime contract for a later reviewed Schedule activation, not an authorization to enqueue jobs now.

## Current workstream record

```text
Base main           = 05ddfd8f30bdb5ea01d6e604fba501b02413b934
Branch              = agent/chatwoot-runtime-all-flags-false-wiring
Draft PR            = #309
Migration authority = 0018_chatwoot_analytics.sql (unchanged)
Lark schema         = 15 / 15 existing; no Apply rerun
Remote actions      = 0
```

`docs/current-task.md` is not modified because another active Workstream owns it.
