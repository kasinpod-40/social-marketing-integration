# Current Task — Organic D1 Dual-write and Controlled Bootstrap

## Status

- **Task status:** `implementation_complete_pending_merge`
- **Approved by user:** `2026-07-23`
- **Main baseline:** `52316eeb308126acddeae2b67f1d6b28dddec27b`
- **Implementation PR:** `#27` — `feat: add manual TikTok Organic D1 bootstrap`
- **Contract:** `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- **Runbook:** `docs/runbooks/tiktok-organic-d1-bootstrap.md`
- **Integration Workspace:** one pre-Production workspace
- **Schedules:** disabled
- **Production:** blocked

## Objective

Deliver a controlled Organic Marketing-history path without writing the 2,021-row TikTok source into the current Lark Canonical/report path:

```text
Protected RAW_TikTok_Creator_Videos
→ strict Chemistry K identity
→ bounded durable source staging
→ D1 organic_content_state
→ D1 organic_content_observations
→ D1 data_coverage_runs / data_coverage_entities
→ reconciliation + idempotent retry evidence
```

The first rollout destination remains **D1-only** because the existing Lark TikTok Report reader still caps `MKT_Content` at 800 rows.

```text
LIVE_BOOTSTRAP_DESTINATION = D1_ONLY
LIVE_LARK_CANONICAL_WRITE = BLOCKED
```

## Authoritative runtime identity

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
reportingTimezone=Asia/Bangkok
```

Integration Workspace rejects a TikTok source-handle override that would store another source under the Chemistry K Stable key. Historical profile/account labels remain compatibility metadata only.

## Implemented

### Manual bootstrap route

Added active manual-only Job:

```text
tiktok.creator.native.history.bootstrap
```

Behavior:

- never emitted by `scheduled-jobs.js`;
- requires `trigger=manual`;
- requires both `MKT_TIME_SERIES_D1_WRITE_ENABLED=true` and `MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true`;
- restricted to `development + integration_workspace`;
- reuses the central Job/Connector catalogs, reliable runner, distributed lock, durable staging, resumable work, Queue/DLQ and redaction stack;
- `dryRun=true` performs zero Marketing-history and zero Lark business writes;
- live bootstrap mode writes D1 only.

Added payload-only helper:

```bash
npm run job:tiktok-history-bootstrap
```

The helper prints a validated body and never sends it.

### D1 gateway and schema guard

Added a lazy Organic history gateway over the existing `MKT_STATE_DB` and `D1MarketingHistoryStore`.

Before source processing it verifies Migration `0009` tables:

```text
organic_content_state
organic_content_observations
data_coverage_runs
data_coverage_entities
```

Missing schema fails closed; no parallel D1 binding or Reliability stack was added.

### Organic history mapping

Added reusable Application-layer mapping/writing for exact Storage Contract rows.

Semantics:

- `content_key=platform:account_key:external_content_id`;
- `observed_at` and `fetched_at` are stable for one durable Work generation;
- `metric_date` is derived from `observed_at` in the reporting timezone;
- first trusted metrics create `initial`;
- changed cumulative metrics create `changed`;
- cumulative decreases create `correction`;
- unchanged metrics create no new Observation;
- metadata-only changes update Current state without fabricating metric history;
- missing remains `null`; observed zero remains `0`;
- no historical Daily rows are synthesized.

### Coverage and reconciliation

Bootstrap uses:

```text
dataset_key=organic_content_cumulative
metric_semantics=cumulative
scope_mode=full_inventory
```

Coverage run/entity IDs are deterministic from durable Work identity. Invalid, skipped or duplicate evidence produces `partial`, never a false `complete`. Partial evidence never deletes or zeroes unseen facts.

Bootstrap results and Sync Log reconciliation expose:

- Coverage status and run ID;
- source watermark;
- expected/observed/skipped/duplicate counts;
- planned and durable D1 rows;
- Observation outcomes;
- zero Lark writes.

Incomplete Coverage produces a persisted warning path through the existing Reliability system.

### D1-first Canonical integration

When `MKT_TIME_SERIES_D1_WRITE_ENABLED=true` in a separately approved future Canonical run, staged TikTok units execute:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

Guarantees:

- D1 failure starts zero Lark writes;
- Lark failure after D1 success is retryable;
- retry replays D1 idempotently and repairs Lark;
- attempt-level D1 counters are separate from durable Work totals;
- no unit completes before every required destination completes.

This implementation does **not** authorize or execute the full Lark Canonical run.

### Guarded rollout runbook

`docs/runbooks/tiktok-organic-d1-bootstrap.md` documents, but does not execute:

1. read-only remote D1 inspection and capacity evidence;
2. remote export and SHA-256 backup;
3. pending migration review;
4. explicitly confirmed Migration `0009` apply;
5. schema verification;
6. explicitly confirmed deployment with every schedule false;
7. dry-run Queue payload/send;
8. bounded live D1-only payload/send;
9. row, Stable-key and Coverage reconciliation;
10. semantic rerun;
11. rollback by disabling flags without deleting facts or Lark records.

## Acceptance result

### Configuration and routing

- [x] Bootstrap Job is in the central Job catalog and cannot be scheduled.
- [x] Manual trigger is mandatory.
- [x] Bootstrap fails closed unless D1 write and backfill flags are both true.
- [x] Invalid Boolean/flag dependencies fail permanently.
- [x] Integration Workspace TikTok ownership cannot drift through an Environment override.
- [x] Dry run performs no D1/Lark business write.

### Mapping and semantics

- [x] Generated rows pass exact Storage Contract validation.
- [x] Current state preserves first-seen and non-null metrics.
- [x] Initial, changed and negative correction are classified correctly.
- [x] Unchanged retry creates no Observation.
- [x] Metric date derives from observed time in `Asia/Bangkok`.
- [x] `null` and observed `0` remain distinct.
- [x] No fake historical dates are created.

### Reliability and reconciliation

- [x] Source pages remain bounded and durable.
- [x] D1 is written before Lark in flagged dual-write mode.
- [x] D1 failure produces zero Lark writes.
- [x] Lark failure after D1 success is recoverable without duplicate D1 facts.
- [x] Coverage run/entity counts reconcile to selected rows.
- [x] Partial evidence never deletes or zeroes unseen facts.
- [x] Retry/DLQ/redrive continue using the existing identity/secret-safe stack.
- [x] Attempt and durable Work D1 counters are separated.

### Bootstrap evidence

- [x] Local tests replay Migration `0009` and bootstrap writes idempotently.
- [x] Dry-run reports planned D1 rows and zero Lark writes.
- [x] Same durable Work replay creates zero duplicate facts.
- [x] New generation with unchanged metrics advances Current/Coverage without fake metric history.
- [x] New generation with changed metrics creates exactly one new Observation.

## Verification

Latest implementation verification:

```text
Head                              0618f3ef6777e1ad3ec37b2b88d2b03e1dd87129
Branch Verification               run #321 / ID 30006167877 / PASS
Syntax / architecture / hygiene   PASS
Focused staged TikTok tests       PASS
Unit + Workers runtime            PASS
Report reliability regression     PASS
Dependency audit                  PASS
Wrangler dry run                  PASS
```

A final verification must run again after this documentation result commit before merge.

## Explicitly not performed

```text
REMOTE_D1_INSPECTION       = NOT_RUN
REMOTE_D1_BACKUP           = NOT_RUN
REMOTE_MIGRATION_0009      = NOT_APPLIED
WORKER_DEPLOYMENT          = NONE
QUEUE_MESSAGE              = NONE
LIVE_D1_BOOTSTRAP          = NONE
LARK_SCHEMA_MUTATION       = NONE
LARK_RECORD_MUTATION       = NONE
LIVE_TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_CUTOVER             = BLOCKED
LARK_RETENTION             = BLOCKED
SCHEDULE                   = DISABLED
GOOGLE_ADS_PR_17           = HOLD
PRODUCTION                 = BLOCKED
```

## Merge and rollout boundary

Merging PR #27 authorizes source availability only. It does not automatically authorize Remote migration, deployment or Queue delivery.

The next possible step after merge is a separately confirmed **guarded Integration Workspace rollout** following the runbook in order:

```text
read-only D1 preflight
→ backup
→ Migration 0009
→ deploy with schedules false
→ dry-run bootstrap
→ review evidence
→ live D1-only bootstrap
→ reconciliation
→ semantic rerun
```

Any mismatch stops the rollout. No cleanup/delete path is allowed.
