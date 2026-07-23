# Current Task — Organic D1 Dual-write and Controlled Bootstrap

## Status

- **Task status:** `approved_for_implementation`
- **Approved by user:** `2026-07-23`
- **Main baseline:** `9e54ef339cfe02ca24bda3d2eaae807f130e1b79`
- **Previous task:** `STORAGE_FOUNDATION_PHASE_1_COMPLETE`
- **Contract:** `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- **Integration Workspace:** one pre-Production workspace
- **Schedules:** disabled
- **Production:** blocked

## Objective

Implement the first Organic Marketing-history writer and a controlled TikTok bootstrap path:

```text
Protected RAW_TikTok_Creator_Videos
→ strict source identity + bounded durable staging
→ D1 organic_content_state
→ D1 organic_content_observations
→ D1 data_coverage_runs / data_coverage_entities
→ reconciliation + idempotent retry evidence
```

The implementation must also prepare the existing TikTok Canonical sync for D1-first dual-write behind a disabled-by-default Feature flag, without enabling the customer-visible Lark write in this task.

## Authoritative runtime identity

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
reportingTimezone=Asia/Bangkok
```

Historical profile/account labels remain compatibility metadata only and must not create another customer identity or authorize record cleanup.

## Key safety decision

The current TikTok RAW source contains about 2,021 records while the existing Lark Report reader still caps `MKT_Content` at 800 records. Therefore the first live bootstrap in this task is **D1-only**.

```text
LIVE_BOOTSTRAP_DESTINATION = D1_ONLY
LIVE_LARK_CANONICAL_WRITE = BLOCKED
```

The code may support D1-first dual-write for a later approved bounded Canonical run, but this task must not enable or execute the full RAW → `MKT_Content` / `MKT_Content_Daily` write.

## In scope

### 1. Manual-only bootstrap job

Add one explicit active Job type:

```text
tiktok.creator.native.history.bootstrap
```

Rules:

- never emitted by `scheduled-jobs.js`;
- accepted only through an explicit manual Queue message;
- reuses the existing Connector catalog, Queue router, reliable sync runner, distributed lock, durable source staging, resumable work, DLQ and redaction stack;
- requires `MKT_TIME_SERIES_D1_WRITE_ENABLED=true` and `MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true`;
- fails closed when either flag is false;
- supports `dryRun=true` without D1 or Lark business writes;
- bootstrap write mode writes D1 only.

Add a local helper command that prints a validated manual Queue payload but does not send it.

### 2. D1 Marketing-history infrastructure wiring

- Lazily create `D1MarketingHistoryStore` from `MKT_STATE_DB` only for routes that require it.
- Add a schema-readiness check for Migration `0009` tables before the first Source read/write.
- Missing tables must fail permanently with a redacted storage-schema error.
- Do not create a parallel D1 binding or reliability stack.

### 3. Reusable Organic history builder/writer

Add an Application-layer service reusable by future Organic connectors.

Input must include:

```text
customerProfile
customerKey
platform
accountKey
sourceAccountId (nullable)
sourceTimezone
observedAt
fetchedAt
syncRunId
coverageRunId
sourceRevision (nullable)
scopeMode
normalized Content rows
normalized cumulative metric rows
```

It must create exact Contract rows for:

```text
organic_content_state
organic_content_observations
data_coverage_runs
data_coverage_entities
```

No Lark field names may leak into the D1 repository contract beyond the explicit mapping service.

### 4. Observation and time semantics

Bootstrap must not invent historical dates.

- `observed_at` is the durable source-request instant for the Work generation, not `published_at` and not an arbitrary historical `metric_date`;
- `metric_date` is derived from `observed_at` using the reporting timezone;
- `fetched_at` is stable for retries of the same durable Work generation;
- the first trusted row creates `observation_kind=initial`;
- changed cumulative metrics create `changed`;
- a decrease in any observed cumulative counter creates `correction`;
- unchanged cumulative metrics do not create another Observation;
- metadata-only changes may update Current state without creating a metric Observation;
- missing metrics remain `null`; observed zero remains `0`;
- no daily rows are synthesized for dates before the bootstrap observation.

### 5. Stable identity and retry behavior

- `content_key` remains `platform:account_key:external_content_id`;
- `coverage_run_id` must be deterministic for durable Work key + generation + dataset;
- `coverage_entity_key` follows the approved Contract;
- Observation identity remains stable across Queue retries of the same Work generation;
- a retry with the same durable payload is a no-op, not a duplicate;
- a retry that reuses an Observation key with changed business payload fails closed;
- attempt-specific `syncRunId` changes must not create duplicate Observations for the same durable source snapshot.

### 6. Coverage contract

Bootstrap coverage uses:

```text
dataset_key=organic_content_cumulative
metric_semantics=cumulative
scope_mode=full_inventory
```

Required behavior:

- create/update a deterministic Coverage run;
- record each selected Content as `observed` only after identity and row validation;
- `expected_entities`, `observed_entities`, `expected_rows` and `observed_rows` must reconcile exactly;
- invalid/skipped source rows make Coverage `partial`, never silently `complete`;
- Source unavailable or incomplete staging must not zero or delete existing facts;
- Coverage completion occurs only after all D1 units are durable;
- result and Sync Log expose Coverage status, counts and source watermark without secrets.

### 7. D1-first dual-write integration

Prepare the existing staged TikTok Canonical path so that when `MKT_TIME_SERIES_D1_WRITE_ENABLED=true` in a later approved run:

1. all unit rows and D1 contracts are validated before the unit writes;
2. D1 Current state/Observation/Coverage writes happen before Lark Content/Daily writes;
3. D1 failure prevents the Lark unit from starting;
4. Lark failure after D1 success is retryable;
5. retry replays D1 idempotently and repairs Lark;
6. durable work state and result counters distinguish D1 writes from Lark writes;
7. no unit is marked complete until the required destinations for that mode complete.

For the bootstrap Job in this task, required destination mode is `d1_only`; Lark plan execution is skipped.

### 8. Runtime configuration

Extend fail-closed rules:

- `MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true` requires `MKT_TIME_SERIES_D1_WRITE_ENABLED=true`;
- Report reader, materialization, Lark retention and Notification flags remain false;
- enabling the D1 write flag does not enable a schedule;
- Production remains blocked.

### 9. Guarded rollout artifacts

Add a runbook for the Integration Workspace with:

1. read-only remote D1 table/row/size inspection;
2. exact backup/export command;
3. additive remote Migration `0009` apply command with explicit confirmation;
4. schema verification;
5. dry-run bootstrap payload;
6. bounded live D1-only bootstrap payload;
7. D1 row-count and Stable-key reconciliation;
8. idempotent rerun;
9. rollback by disabling both Storage write/backfill flags;
10. no Lark cleanup or Schedule enablement.

Repository implementation does not itself apply the Remote migration or send the Queue message automatically.

## Out of scope

- full TikTok RAW → `MKT_Content` / `MKT_Content_Daily` live write;
- changing current Lark Tables, Fields, Views, Formulas or Records;
- importing existing `MKT_Content_Daily` rows as trusted history;
- creating synthetic historical observations;
- Report D1 shadow reader or customer-visible cutover;
- Dashboard UI changes;
- Lark Daily retention or deletion;
- Organic Account Daily facts;
- YouTube/Meta Organic writer activation;
- Ads facts or Google Ads PR `#17`;
- Notification implementation;
- automatic remote D1 migration;
- Worker deployment from the implementation PR;
- Schedule enablement;
- Production.

## Acceptance criteria

### Configuration and routing

- [ ] New bootstrap Job is in the central Job catalog and cannot be scheduled.
- [ ] Bootstrap fails closed unless both D1 write and backfill flags are true.
- [ ] Invalid Boolean/flag dependencies fail permanently.
- [ ] Dry run performs no D1/Lark business write.

### Mapping and semantics

- [ ] All generated D1 rows pass exact Storage Contract validation.
- [ ] Current state preserves first seen time and non-null metrics.
- [ ] First observation, changed observation and negative correction are classified correctly.
- [ ] Unchanged retry does not create an Observation.
- [ ] Metric date is derived from observed time in `Asia/Bangkok`.
- [ ] `null` and observed `0` remain distinct.
- [ ] Bootstrap creates no fake historical dates.

### Reliability and reconciliation

- [ ] Source pages remain bounded and durable.
- [ ] D1 is written before Lark in dual-write mode.
- [ ] D1 failure produces zero Lark writes.
- [ ] Lark failure after D1 success is recoverable by retry without duplicate D1 facts.
- [ ] Coverage run/entity counts reconcile to selected source rows.
- [ ] Partial/invalid source evidence never deletes or zeroes unseen facts.
- [ ] Retry, DLQ and redrive payloads remain identity/secret safe.

### Bootstrap evidence

- [ ] Local tests replay Migration `0009` and bootstrap writes idempotently.
- [ ] Dry-run result reports exact planned D1 rows and zero Lark writes.
- [ ] Same durable bootstrap Work rerun creates zero duplicate Content/Observation rows.
- [ ] A new Work generation with unchanged metrics updates Coverage/Current observation time without fabricating metric history.
- [ ] A new Work generation with changed metrics creates exactly one new Observation.

## Required gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Add focused tests for Job routing, Feature flags, Organic history mapping, D1 ordering, retry recovery, Coverage and bootstrap output.

## Implementation result

Pending.

## Safety boundary

```text
LARK_SCHEMA_MUTATION = NONE
LARK_RECORD_MUTATION = NONE_FOR_BOOTSTRAP
REMOTE_D1_MIGRATION = MANUAL_GUARDED_STEP_ONLY
LIVE_BOOTSTRAP = D1_ONLY_AFTER_CODE_AND_PREFLIGHT
LIVE_TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_CUTOVER = BLOCKED
LARK_RETENTION = BLOCKED
SCHEDULE = DISABLED
GOOGLE_ADS_PR_17 = HOLD
PRODUCTION = BLOCKED
```
