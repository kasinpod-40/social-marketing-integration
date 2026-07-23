# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

## Current repository state

```text
Storage Architecture                V1 documented
Storage Foundation Phase 1A         merged
Storage Foundation Phase 1B         merged
Organic D1 bootstrap PR #27         merged
Organic D1 bootstrap merge          d182bf9efc8c6ea51f275ea725cdb0eaeae3d5e0
Remote Migration 0009               not applied
Worker deployment                   none from PR #27
Queue delivery                      none from PR #27
Live D1 bootstrap                   not run
TikTok Canonical Lark sync          blocked
Report D1 reader                    not implemented
Lark retention                      blocked
Schedules                           disabled
Production                          blocked
```

Authoritative documents:

```text
docs/current-task.md
docs/project-brain/storage-architecture-and-migration-contract-v1.md
docs/runbooks/tiktok-organic-d1-bootstrap.md
```

Google Ads signed-delivery PR #17 remains Draft/HOLD and must not be merged against the old Storage/RAW lineage model.

## Integration Workspace operating model

There is one pre-Production **Integration Workspace**, not separate DEV/UAT operating modes.

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

Current Workspace infrastructure is developer-owned. Source ownership is tracked per Connector and may be mixed temporarily. Production is separate and must use customer-owned resources.

TikTok Organic identity is fixed to:

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

Historical profile/account labels are compatibility metadata only. Integration Workspace rejects an Environment handle override that would place another TikTok source under the Chemistry K Stable key.

## Current Lark Base baseline

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Google Ads formulas          4/4 PASS
Google Ads filters          19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Relevant TikTok inventory at the last verified audit:

```text
RAW_TikTok_Creator_Videos   approximately 2,021 records / 18 fields
MKT_Content                 22 records / 29 fields
MKT_Content_Daily           208 records / 15 fields
```

`RAW_TikTok_Creator_Videos` is protected/read-only. Do not rerun Lark View/Formula/Filter Apply from the Organic bootstrap task.

## Storage Architecture v1

```text
Platform / Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic report calculation
→ Lark current state + bounded cache + aggregate + report result
→ Dashboard / AI / Notification
```

Exact Foundation tables:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
report_materializations
report_requests
```

Names, Grain, Stable keys, Fields, Indexes and UPSERT rules are locked in the Storage contract. Contract changes require a revision.

## Completed foundations

### Runtime and ownership

- canonical `integration_workspace` profile exists;
- legacy DEV/UAT names resolve only as compatibility aliases;
- TikTok Stable identity is Chemistry K;
- every Connector and schedule remains disabled by default in release examples;
- `MKT_Content` uses a reusable ownership policy;
- protected manual classification and `manual_tag_note` survive reruns;
- TikTok and YouTube use the same Organic ownership boundary.

### D1 Storage Foundation

Migration `0009_storage_foundation.sql` and typed repositories exist locally with:

- additive/replay-safe schema;
- deterministic Stable keys;
- Organic observation conflict protection;
- Ads old-day revision behavior;
- Coverage and report state;
- bounded JSON/query guards;
- no delete/retention methods.

Remote Migration `0009` has not been applied.

## Organic D1 bootstrap implementation

Manual Job:

```text
tiktok.creator.native.history.bootstrap
```

Runtime behavior:

- manual trigger only;
- never scheduled;
- Integration Workspace only;
- requires D1 write and backfill flags;
- schema readiness check before Source processing;
- protected TikTok RAW is durably staged in bounded units;
- Dry-run performs zero Marketing-history and zero Lark business writes;
- live bootstrap destination is D1 only;
- full preflight finishes before the first D1 business write;
- Coverage status, run ID, watermark and counters are available for Sync Log/reconciliation.

Organic observation rules:

```text
first trusted cumulative metrics   initial
changed cumulative metrics         changed
cumulative decrease                correction
unchanged cumulative metrics       no new Observation
metadata-only change               Current state update only
missing metric                     null
observed zero                      0
```

`observed_at` and `fetched_at` are stable for a durable Work generation. `metric_date` derives from `observed_at` in the Reporting timezone. No historic Daily rows are synthesized.

Coverage contract:

```text
dataset_key=organic_content_cumulative
metric_semantics=cumulative
scope_mode=full_inventory          # bootstrap
scope_mode=exact_entities          # later incremental D1-first units
```

Invalid/skipped/duplicate evidence results in `partial`, never false `complete`. Partial evidence cannot delete or zero unseen facts.

## D1-first TikTok Canonical preparation

The staged TikTok path supports D1-first hooks behind `MKT_TIME_SERIES_D1_WRITE_ENABLED`:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

Guarantees verified by focused tests:

- D1 failure produces zero Lark writes;
- Lark failure after D1 success is retryable;
- retry replays D1 idempotently and repairs Lark;
- durable and attempt-level D1 counters are separate;
- unit completion waits for every required destination.

The full Lark Canonical run remains blocked and was not executed.

## Why the first rollout is D1-only

The protected RAW source contains approximately 2,021 records, while the current TikTok Report reader caps:

```text
MKT_Content          800 rows
MKT_Content_Daily 50,000 rows
```

`MKT_Content_Daily` is still the current cumulative baseline source. Writing the full RAW set to Lark before a D1 Report shadow reader and parity gate could make current Reports fail or exceed the Daily reader boundary.

Therefore:

```text
LIVE_BOOTSTRAP_DESTINATION = D1_ONLY
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_READER_CUTOVER = BLOCKED
LARK_DAILY_RETENTION = BLOCKED
```

## Dashboard contract

Customer-visible ranges remain mandatory:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

Rules:

- rolling completed days ending yesterday by Reporting timezone;
- Organic cumulative metrics use end observation minus pre-period baseline;
- Ads use additive Daily facts with Attribution revision;
- old Content without a baseline is `partial`;
- missing metric is `null`; observed zero is `0`;
- Dashboard must expose Coverage/Data status and source watermark.

Report D1 shadow-read/cutover is a later task.

## Lark roles after cutover

- `MKT_Content`: current-state Content with manual field protection;
- `MKT_Content_Daily`: bounded recent/diagnostic cache only after D1 parity and Reader cutover;
- `MKT_Account_Daily`: Account×Date aggregate;
- `MKT_Ads_Daily`: bounded recent Ads detail after parity;
- `MKT_Report_*`: deterministic materialized KPI/comparison/Top results;
- Protected RAW: unchanged and never mutated by our Worker.

No retention or delete is authorized.

## Feature flags

All release examples default to `false`:

```text
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_TIME_SERIES_D1_BACKFILL_ENABLED
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
MKT_LARK_DAILY_RETENTION_ENABLED
MKT_NOTIFICATION_RUNTIME_ENABLED
```

Backfill requires D1 write. Retention requires Report D1 reader. Storage flags never enable schedules.

## Guarded rollout boundary

Runbook:

```text
docs/runbooks/tiktok-organic-d1-bootstrap.md
```

Required order:

```text
read-only D1 preflight
→ capacity evidence
→ remote export + SHA-256
→ pending migration review
→ explicit Migration 0009 confirmation
→ schema verification
→ explicit deploy confirmation with schedules false
→ Dry-run Queue message
→ evidence review
→ live D1-only Queue message
→ row/Stable-key/Coverage reconciliation
→ semantic rerun
```

No Remote action in this sequence has been executed by PR #27.

Rollback is non-destructive: disable backfill/write/TikTok flags and redeploy through separate confirmation. Never drop tables, delete D1 facts or clean Lark records as routine rollback.

## RAW lineage rule

Each Connector must declare one path:

```text
Provider-specific RAW → Shared RAW → Canonical
```

or:

```text
Provider-specific RAW → Canonical
Shared RAW not used by that Connector
```

Do not dual-write both RAW layers without Stable-key parity and reconciliation.

## Google Ads current state

Completed read-only preparation includes account link/selectability, Manager Script Preview, six bounded non-empty datasets, zero dataset errors/truncation and completed Lark schema/view/formula work.

Draft PR #17:

- not merged;
- not deployed;
- not externally LIVE validated;
- must be rebuilt/rebased against the current Storage, Coverage, revision and RAW-lineage contracts;
- remains HOLD.

Draft PR #11 is obsolete/superseded and must not be merged.

## Core runtime rules

Every active write path must reuse:

- central Connector and Job catalogs;
- deterministic Stable keys;
- idempotent plan/diff/execute;
- D1 checkpoints and resumable work;
- distributed lock and renewal;
- bounded retry and Permanent classification;
- Queue/DLQ and controlled redrive;
- reconciliation and alerts;
- secret/identity redaction;
- explicit Coverage and metric semantics.

Do not create a parallel Reliability stack.

## Current task and next boundary

Authoritative task: `docs/current-task.md`

```text
CURRENT_TASK = ORGANIC_D1_BOOTSTRAP_IMPLEMENTATION_MERGED
NEXT_TASK = GUARDED_REMOTE_ROLLOUT_NOT_APPROVED
```

The source and runbook are available on `main`. Remote D1 preflight, backup, Migration `0009`, deployment and Queue delivery require a separate explicit approval.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- no Canonical TikTok scale before Report D1 parity;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no Lark Schema/View/Formula reopening from this task;
- no merging Draft PR #17 against the old Storage model;
- Connector flags and schedules disabled by default;
- secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.
