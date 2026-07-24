# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

## Current verified state — 2026-07-24

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
TikTok Organic D1 bootstrap                   complete
TikTok durable recovery                       complete
TikTok completion closure                     complete
TikTok same-generation replay                 pass / no business drift
Migration 0009                                applied remotely
Migration 0010                                applied remotely
Organic Content State                         2021
Organic Observations                          2021
Initial Observations                          2021
Coverage Entities                             2021
Duplicate State/Observation groups            0 / 0
Coverage                                      complete / 2021 of 2021 / failed 0
Lark business writes from bootstrap/recovery  0
TikTok Canonical Lark full backfill            blocked
Report D1 reader                              not implemented
Lark retention                                blocked
Schedules                                     disabled
Production                                    blocked
Google Ads PR #17                             Draft / HOLD
```

Authoritative closeout:

```text
docs/current-task.md
docs/rollouts/tiktok-organic-durable-recovery-closeout-2026-07-24.md
```

Final completion-closure source head:

```text
870ac618c75e3d9efa1fd1e20ea3618b56f8aceb
```

## Integration Workspace operating model

There is one pre-Production **Integration Workspace**, not separate DEV/UAT operating modes.

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

Current Workspace infrastructure is developer-owned. Source ownership is tracked per Connector and may be mixed temporarily. Production is separate and must use customer-owned Lark Base, Cloudflare resources, credentials and platform assets.

TikTok Organic identity is fixed to:

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

Historical profile/account labels are compatibility metadata only. They are not evidence for record ownership and must not be used to rename/delete facts.

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

Relevant TikTok Lark inventory at the last verified audit:

```text
RAW_TikTok_Creator_Videos   approximately 2021 records / protected native source
MKT_Content                 bounded existing Canonical table
MKT_Content_Daily           current cumulative baseline table
```

`RAW_TikTok_Creator_Videos` remains protected/read-only. Do not rerun Lark Schema/View/Formula/Filter Apply from the Organic bootstrap/recovery work.

## Storage Architecture v1

```text
Platform API / Lark Native Sources
→ source-specific validation
→ D1 current state + historical facts + Coverage
→ deterministic report calculation/materialization
→ Lark current state + bounded cache + aggregate/report result
→ Dashboard / AI / Notification
```

D1 Storage authority includes:

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

Names, Grain, Stable keys, metric semantics, indexes and UPSERT rules remain governed by:

```text
docs/project-brain/storage-architecture-and-migration-contract-v1.md
```

## TikTok Organic D1 bootstrap result

Manual jobs:

```text
tiktok.creator.native.history.bootstrap
tiktok.creator.native.history.recover
```

Verified runtime behavior:

- manual/recovery trigger only;
- never emitted by schedules;
- Integration Workspace only;
- requires D1 write and backfill flags;
- protected RAW is staged in bounded durable units;
- full source preflight finishes before business writes;
- durable unit write order is Observation → State → Coverage;
- Stable operation identity survives retry, continuation and DLQ;
- generation fence blocks stale drift;
- partial business facts are retained and repaired idempotently;
- Dry-run remains Dry-run through continuations;
- bootstrap/recovery destination is D1-only;
- Lark business writes remain zero.

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

`observed_at` and `fetched_at` remain stable for a durable Work generation. No fake historical Daily rows are synthesized.

## Durable recovery closeout

Immutable incident:

```text
operation_id       = f59b852f00634005c7ff4da51afee964
work_key           = tiktok:f59b852f00634005c7ff4da51afee964
generation         = 1784829780000
original_dlq       = dlq:8d1b9077657385a417cb32a0ed3114cb
failed_recovery    = dlq:06f7660b796808ebca3b8cd2e7780894
terminal_closure   = terminal:a90a4dbf2f281124d40601f2f7799a90
```

Final facts:

```text
State / Observation / Initial / Coverage = 2021 / 2021 / 2021 / 2021
Duplicate groups                          = 0 / 0
Work                                      = completed
Coverage                                  = complete
Original DLQ                              = redriven / recovery completed
Terminal closure DLQ                      = redriven / closure completed
Failed-recovery DLQ                       = open / retained forensic evidence
Main Queue attempts after exact replay    = 10
Business fact drift                       = false
Unexpected terminal failures              = 0
```

The failed-recovery DLQ must remain retained. No routine cleanup/delete/redrive is authorized.

## D1-first TikTok Canonical preparation

The staged path supports D1-first hooks behind `MKT_TIME_SERIES_D1_WRITE_ENABLED`:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

This future dual-write path remains blocked for full live TikTok Canonical scale. The completed bootstrap/recovery did **not** authorize Lark Canonical backfill.

## Why Lark Canonical and Report cutover remain blocked

The protected RAW source is approximately 2,021 records while the current TikTok report path still has bounded Lark readers and uses the existing cumulative Daily baseline.

```text
LIVE_BOOTSTRAP_DESTINATION = D1_ONLY
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_D1_SHADOW_READ = DISABLED
REPORT_D1_READER_CUTOVER = BLOCKED
LARK_DAILY_RETENTION = BLOCKED
```

No retention or delete is authorized.

## Feature-flag state after closeout

Enabled in the Integration Workspace deployment:

```text
MKT_CONNECTOR_TIKTOK_ENABLED
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_TIME_SERIES_D1_BACKFILL_ENABLED
```

Disabled:

```text
MKT_SCHEDULE_TIKTOK_ENABLED
MKT_SCHEDULE_YOUTUBE_ENABLED
MKT_SCHEDULE_DAILY_REPORT_ENABLED
MKT_SCHEDULE_WEEKLY_REPORT_ENABLED
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_LARK_DAILY_RETENTION_ENABLED
MKT_NOTIFICATION_RUNTIME_ENABLED
MKT_DLQ_REDRIVE_ENABLED
```

Storage flags never enable schedules.

## Google Ads current state

Completed read-only preparation includes:

- Chemistry K advertiser link/selectability verification;
- Manager Script authorization and bounded Preview;
- six non-empty bounded datasets;
- zero dataset errors/truncation;
- completed Lark schema/view/formula work;
- no Google Ads schedule.

Draft PR #17:

- remains Draft/HOLD;
- is not the next implementation baseline;
- was not deployed or externally live-validated;
- must not be merged against the old Storage/RAW-lineage model;
- requires a new full-codebase review and approved task for the signed Manager Script delivery connector.

## Core runtime rules

Every active write path must reuse:

- central Connector and Job catalogs;
- deterministic Stable keys;
- idempotent plan/diff/execute;
- D1 checkpoints and resumable work;
- generation fence and distributed lock renewal;
- bounded retry and typed Permanent classification;
- Queue/DLQ and controlled redrive;
- reconciliation, Coverage and alerts;
- secret/identity redaction;
- explicit null/zero and metric semantics.

Do not create a parallel Reliability stack.

## Current task and next boundary

```text
CURRENT_TASK = TIKTOK_ORGANIC_DURABLE_RECOVERY_ROLLOUT_COMPLETE
NEXT_TASK = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_CONNECTOR_PLANNING
NEXT_TASK_STATUS = NOT_STARTED
```

The next task must read `AGENTS.md`, `docs/current-task.md`, this Project Brain, the Storage contract and all current Google Ads code/docs before planning. No implementation, merge, deployment or schedule follows automatically from this closeout.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- no Canonical TikTok scale before Report D1 parity;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no Lark Schema/View/Formula reopening from this task;
- no rerun of the completed TikTok recovery/resume/repair/replay operators;
- no merging Draft PR #17 against the old Storage model;
- Connector flags and schedules disabled by default;
- secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.
