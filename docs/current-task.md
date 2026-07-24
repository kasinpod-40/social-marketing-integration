# Current Task — TikTok Organic Bootstrap Durable Recovery Hotfix

## Status

- **Task status:** `implementation_merged_rollout_not_started`
- **Opened:** `2026-07-24`
- **Implementation PR:** `#29` — `fix: recover TikTok bootstrap durable work safely`
- **Verified implementation head:** `e77633442cc48454df134c608bd4740254d43d2f`
- **Branch Verification:** run `#342` / ID `30038029278` / PASS
- **Squash merge commit:** `1fce94344100a6b1ed9dce471966f3596c00778a`
- **Merged into:** `main`
- **Remote recovery execution:** not performed / not approved
- **Schedules:** disabled
- **Google Ads PR #17:** Draft / HOLD
- **Production:** blocked

## Incident identity — immutable

```text
original_requested_at = 1784829780000 / 2026-07-23T18:03:00Z
operation_id           = f59b852f00634005c7ff4da51afee964
original_work_key      = tiktok:f59b852f00634005c7ff4da51afee964
generation             = 1784829780000
dlq_id                  = dlq:8d1b9077657385a417cb32a0ed3114cb
dlq_message_id          = 8d1b9077657385a417cb32a0ed3114cb
```

Durable checkpoint at interruption:

```text
phase                    = tiktok_organic_history_write_v1
nextSequence             = 2
unitsCompleted           = 2
rawRecordsCompleted      = 1000
contentRowsDurable       = 1000
observationRowsDurable   = 1000
coverageEntitiesWritten  = 1000
```

Observed D1 business facts remain unchanged by this source task:

```text
organic_content_state         = 1309
organic_content_observations  = 1000
data_coverage_entities        = 1000
coverage.expected             = 2021
coverage.status               = partial
coverage.completed_at         = null
```

Lock evidence:

```text
last_renewed = 2026-07-24 01:17:39 Asia/Bangkok
expired      = 2026-07-24 01:27:39 Asia/Bangkok
lease_ms     = 600000
renew_ms     = 120000
```

Queue evidence:

```text
max_concurrency       = 1
max_retries           = 5
retry_delay_base      = 30 seconds
DLQ status            = open
DLQ error_code        = QUEUE_RETRY_EXHAUSTED
```

## Confirmed root causes

1. Bootstrap Work identity depended on Main Queue `message.id`.
2. DLQ receives a different delivery `message.id`.
3. DLQ terminalization derived a new Work key from the DLQ delivery and missed the original Work.
4. DLQ delivery attempts were labelled as the original Main Queue retry count.
5. Five retries could be exhausted before a stale ten-minute lock expired.
6. TikTok history bootstrap had no guarded durable recovery route.
7. One invocation could perform multiple sequential source-Unit D1 writes and stop mid-Unit.
8. The previous writer persisted State before Observation, so the 309 partial State rows could suppress their missing initial Observations on replay.
9. A full-source preflight could still process several staged Units in one invocation.
10. A continuation that forced `dryRun=false` could turn a bounded dry-run into a live write path.

## Merged implementation

- Stable `operationId` is mandatory for bootstrap/recovery jobs.
- `workKey` is derived only as `tiktok:<operationId>` and is validated against payload drift.
- `operationId`, `workKey`, `generation` and `originalRequestedAt` survive retries, continuation, DLQ persistence and recovery.
- Main Queue attempts and DLQ delivery attempts are stored separately.
- Busy-lock retry delay waits past persisted `expiresAt` plus a safety margin.
- Preflight and live write each process at most one staged source Unit per Queue invocation.
- The invocation that finishes the final preflight Unit stops before the first D1 business write.
- Unit completion advances the relevant phase checkpoint, emits one continuation with the same operation identity and dry-run mode, then permits the current message to be acknowledged.
- Mid-Unit interruption leaves `nextSequence` unchanged.
- Durable writer uses deterministic Observation → State → Coverage ordering for future runs.
- Recovery repairs missing initial Observations for State rows created at the exact original operation timestamp.
- Guarded recovery accepts only the exact incident DLQ, Work key, operation ID, generation/requestedAt, expired lock and initial `nextSequence=2` checkpoint.
- Recovery never creates a new generation and never deletes partial business facts.
- Exact DLQ resolution additionally requires completed original Work, complete write phase and complete Coverage proof for 2,021 rows with `failed_rows=0`.
- Exact DLQ row remains retained and receives recovery audit metadata when completed.
- Recovery dry-run is fail-closed; normal bootstrap dry-run remains dry-run across every continuation.
- Lark business writes remain hard zero.

## Acceptance result

- [x] Synthetic interruption after 309 State rows in Unit 3.
- [x] Checkpoint remains at 1,000 rows / `nextSequence=2` after interruption.
- [x] Unit 3 restarts idempotently.
- [x] Existing 309 State rows are preserved and safely replayed.
- [x] Missing initial Observations are repaired exactly once.
- [x] Coverage entities are created exactly once.
- [x] Final State / Observation / Coverage entity counts are each 2,021.
- [x] Initial Observation count is 2,021.
- [x] Duplicate Content and Observation keys are zero.
- [x] Coverage completes with expected=observed=2,021 and failed_rows=0.
- [x] Original durable Work receives completion.
- [x] Exact DLQ recovery guard and audit retention are covered.
- [x] DLQ resolution is blocked until Work, phase and Coverage completion proof pass.
- [x] Lark contentWrites/dailyWrites remain zero.
- [x] Preflight and write are each bounded to one staged Unit per invocation.
- [x] Dry-run remains dry-run through all continuations and performs zero business writes.
- [x] Bootstrap and recovery jobs remain absent from all schedules.
- [x] Full repository CI and regression passed.
- [x] PR #29 was Squash Merged into `main`.

## Verification

```text
Verified implementation head          e77633442cc48454df134c608bd4740254d43d2f
Branch Verification                    run #342 / ID 30038029278 / PASS
Node Unit / Integration                595 / 595 PASS
Workers runtime                        9 / 9 PASS
Focused staged TikTok                  4 / 4 PASS
Report reliability regression          70 / 70 PASS
Syntax / architecture / hygiene        PASS
Dependency audit                       PASS / 0 vulnerabilities
Wrangler dry run                       PASS
Squash merge commit                    1fce94344100a6b1ed9dce471966f3596c00778a
```

## Explicitly not performed

```text
REMOTE_D1_READ            = NONE
REMOTE_D1_WRITE           = NONE
REMOTE_MIGRATION_0010     = NOT_APPLIED
LIVE_RECOVERY             = NOT_EXECUTED
QUEUE_MESSAGE             = NONE
LARK_READ_OR_WRITE        = NONE
CLOUDFLARE_DEPLOYMENT     = NONE
SCHEDULE_CHANGE           = NONE
GOOGLE_ADS_PR_17          = DRAFT_HOLD
PRODUCTION_CHANGE         = NONE
```

## Next approval boundary

Implementation is merged. The next task is **guarded rollout and incident recovery**, which remains not approved. It must separately perform and review:

```text
read-only Remote D1 preflight
→ Remote backup and checksum
→ Migration 0010 review and explicit approval
→ Migration 0010 apply
→ schema verification
→ deploy with all schedules false
→ exact recovery payload review
→ guarded recovery execution
→ Work / Coverage / DLQ reconciliation
→ semantic idempotent rerun evidence
```

Any mismatch must stop the rollout. No cleanup/delete path is authorized, and the 309 partially written State rows must remain intact.

## Handoff

```text
CURRENT_TASK = TIKTOK_BOOTSTRAP_DURABLE_RECOVERY_IMPLEMENTATION_MERGED
NEXT_TASK = GUARDED_REMOTE_ROLLOUT_AND_RECOVERY_NOT_APPROVED
REMOTE_MIGRATION_0010 = NOT_APPLIED
LIVE_RECOVERY = NOT_EXECUTED
QUEUE_MESSAGE = NONE
LARK_BUSINESS_WRITE = NONE
SCHEDULE = DISABLED
GOOGLE_ADS_PR_17 = DRAFT_HOLD
PRODUCTION = BLOCKED
```

---

# Preserved Prior Task Record — Organic D1 Dual-write and Controlled Bootstrap

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
