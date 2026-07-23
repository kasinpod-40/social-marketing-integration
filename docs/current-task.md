# Current Task — Organic D1 Dual-write and Controlled Bootstrap

## Status

- **Task status:** `implementation_merged_rollout_not_started`
- **Approved by user:** `2026-07-23`
- **Implementation PR:** `#27` — `feat: add manual TikTok Organic D1 bootstrap`
- **Squash merge commit:** `d182bf9efc8c6ea51f275ea725cdb0eaeae3d5e0`
- **Contract:** `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- **Runbook:** `docs/runbooks/tiktok-organic-d1-bootstrap.md`
- **Integration Workspace:** one pre-Production workspace
- **Schedules:** disabled
- **Production:** blocked

## Delivered objective

The repository now contains a controlled Organic Marketing-history path that does not write the approximately 2,021-row TikTok source into the current Lark Canonical/report path:

```text
Protected RAW_TikTok_Creator_Videos
→ strict Chemistry K identity
→ bounded durable source staging
→ D1 organic_content_state
→ D1 organic_content_observations
→ D1 data_coverage_runs / data_coverage_entities
→ reconciliation + idempotent retry evidence
```

The first rollout destination remains **D1-only** because the current Lark TikTok Report reader still caps `MKT_Content` at 800 rows.

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

Integration Workspace rejects a TikTok source-handle override that would store another source under the Chemistry K Stable key. Historical names remain compatibility metadata only.

## Delivered implementation

### Manual bootstrap route

Active manual-only Job:

```text
tiktok.creator.native.history.bootstrap
```

- never emitted by schedules;
- requires `trigger=manual`;
- requires D1 write and backfill flags;
- restricted to `development + integration_workspace`;
- reuses the central Job/Connector catalogs, reliable runner, lock, durable staging, resumable work, Queue/DLQ and redaction stack;
- Dry-run performs zero Marketing-history and zero Lark business writes;
- live bootstrap mode writes D1 only.

Payload-only helper:

```bash
npm run job:tiktok-history-bootstrap
```

The helper prints a validated body and never sends it.

### D1 gateway and Organic mapping

The implementation adds:

- lazy Organic history gateway over the existing `MKT_STATE_DB`;
- Migration `0009` schema-readiness guard;
- exact Current-state, Observation and Coverage mapping;
- deterministic Stable keys and Coverage IDs;
- bounded current-state reads;
- full source preflight before the first D1 business write.

Observation semantics:

```text
first trusted cumulative metrics   initial
changed cumulative metrics         changed
cumulative decrease                correction
unchanged cumulative metrics       no new Observation
metadata-only change               Current state update only
missing metric                     null
observed zero                      0
```

`observed_at` and `fetched_at` remain stable for a durable Work generation. `metric_date` derives from `observed_at` in the Reporting timezone. No historical Daily rows are synthesized.

### Coverage and reconciliation

Bootstrap contract:

```text
dataset_key=organic_content_cumulative
metric_semantics=cumulative
scope_mode=full_inventory
```

Invalid, skipped or duplicate evidence produces `partial`, never a false `complete`. Partial evidence never deletes or zeroes unseen facts.

Sync Log reconciliation includes:

- Coverage status and run ID;
- source watermark;
- expected/observed/skipped/duplicate counts;
- planned and durable D1 rows;
- Observation outcomes;
- zero Lark writes.

Incomplete Coverage follows the existing Reliability warning path.

### D1-first Canonical preparation

When separately approved in the future, flagged staged TikTok units execute:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

Verified guarantees:

- D1 failure starts zero Lark writes;
- Lark failure after D1 success is retryable;
- retry replays D1 idempotently and repairs Lark;
- attempt-level D1 counters are separate from durable Work totals;
- no unit completes before every required destination completes.

This implementation does not authorize or execute the full Lark Canonical run.

## Acceptance result

### Configuration and routing

- [x] Bootstrap Job is central, active and impossible to schedule.
- [x] Manual trigger is mandatory.
- [x] D1 write and backfill flags are both required.
- [x] Invalid Boolean/flag dependencies fail permanently.
- [x] Integration Workspace TikTok ownership cannot drift through Environment override.
- [x] Dry-run performs no D1/Lark business write.

### Mapping and semantics

- [x] Generated rows pass the exact Storage Contract.
- [x] Current state preserves first-seen and non-null metrics.
- [x] Initial, changed and correction semantics pass.
- [x] Unchanged retry creates no Observation.
- [x] Metric date derives from observed time in `Asia/Bangkok`.
- [x] `null` and observed `0` remain distinct.
- [x] No fake historical dates are created.

### Reliability and reconciliation

- [x] Source pages remain bounded and durable.
- [x] D1 is written before Lark in flagged dual-write mode.
- [x] D1 failure produces zero Lark writes.
- [x] Lark failure after D1 success is recoverable without duplicate D1 facts.
- [x] Coverage run/entity counts reconcile.
- [x] Partial evidence never deletes or zeroes unseen facts.
- [x] Retry/DLQ/redrive reuse the existing identity/secret-safe stack.
- [x] Attempt and durable Work D1 counters are separated.

### Bootstrap evidence

- [x] Local Migration/bootstrap replay is idempotent.
- [x] Dry-run reports planned D1 rows and zero Lark writes.
- [x] Same durable Work replay creates zero duplicate facts.
- [x] New unchanged generation advances Current/Coverage without fake metric history.
- [x] New changed generation creates exactly one new Observation.

## Verification

```text
Merged implementation head          13a56f5a1eff7e7e3499972b16aee633d6ac4f1e
Branch Verification                 run #327 / ID 30006639550 / PASS
Syntax / architecture / hygiene     PASS
Focused staged TikTok tests         PASS
Unit + Workers runtime              PASS
Report reliability regression       PASS
Dependency audit                    PASS
Wrangler dry run                    PASS
Squash merge commit                 d182bf9efc8c6ea51f275ea725cdb0eaeae3d5e0
```

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

## Next approval boundary

Source implementation is merged. The next task is **not started** and requires a separate explicit confirmation before any Remote action.

Guarded Integration Workspace rollout order:

```text
read-only D1 preflight
→ capacity evidence
→ remote backup + checksum
→ pending migration review
→ Migration 0009
→ schema verification
→ deploy with schedules false
→ Dry-run bootstrap
→ evidence review
→ live D1-only bootstrap
→ reconciliation
→ semantic rerun
```

Any mismatch stops the rollout. No cleanup/delete path is allowed.

## Handoff

```text
CURRENT_TASK = ORGANIC_D1_BOOTSTRAP_IMPLEMENTATION_MERGED
NEXT_TASK = GUARDED_REMOTE_ROLLOUT_NOT_APPROVED
REMOTE_MIGRATION_0009 = NOT_APPLIED
LIVE_D1_BOOTSTRAP = NOT_RUN
LIVE_TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_CUTOVER = BLOCKED
LARK_RETENTION = BLOCKED
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```
