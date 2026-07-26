# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ รายละเอียดย้อนหลังของ Root Project Brain ก่อนงานนี้ถูกเก็บแบบ immutable ที่ `docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md`.

## Current verified repository state — 2026-07-26

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
Current task                                  TikTok Organic post-Lark D1 parity
Task status                                   implementation complete / review pending
Draft PR                                      #65
Branch                                        agent/tiktok-organic-post-lark-d1-parity
Base main                                     e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
Code-verified head                            e3c00b93ea95b4a4e564f09cafacc40954b30593
Branch Verification                          #517 PASS
Migration 0016                                source only / not applied remotely
Worker deployment                            not run
Queue send / DLQ redrive                     none
Remote D1 / Lark mutation                    none
Schedules                                     disabled
Production                                    blocked
Google Ads                                    LIVE UAT complete / safely closed
```

## TikTok Organic identity and source

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
source=lark_native_tiktok_for_creator
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. The Worker may read it but must not mutate its Table, Fields, Views, Formula, Filter or Records.

Retained last verified Live facts remain:

```text
RAW_TikTok_Creator_Videos             approximately 2021
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                2021
D1 duplicate State/Observation groups 0 / 0
MKT_Content                           22 at last verified audit
MKT_Content_Daily                     208 at last verified audit
```

These counts are retained evidence, not a new freshness claim. Any new Live count requires the guarded read-only audit.

## TikTok post-Lark architecture

```text
Lark Native TikTok sync approximately 07:00 Asia/Bangkok
→ bounded read-only RAW probe
→ two identical probes / deterministic watermark
→ durable same-watermark admission
→ existing Durable source staging
→ staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent Daily Report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration
→ existing Report output writer
→ optional deterministic D1 materialization
```

Scheduled `metricDate` is the previous completed local day. The scheduler no longer emits a blind TikTok Business sync and rejects conflicting independent/post-processing Daily Report producers.

No second TikTok connector, Reliability stack, Queue/DLQ framework, D1 history writer, Canonical writer or Report engine was created.

## Repository implementation result

Draft PR `#65` adds:

- deterministic protected-RAW watermark probing and settling;
- additive `tiktok_source_admissions` Migration 0016;
- same-watermark idempotent admission and stable Work identity;
- exact staged-watermark verification before Business writes;
- D1 Organic Report history over State/Observation/Coverage with more than 800 identities;
- null, observed-zero and correction semantics;
- Lark/D1 shadow parity and fail-closed D1-primary gate;
- Coverage-gated post-processing Report admission;
- guarded GET-only operator audit at `/operator/tiktok/post-lark-audit`;
- optional deterministic Report materialization preparation.

Branch Verification `#517` passed:

```text
Focused staged TikTok tests          4 / 4
Node Unit / Integration tests        868 / 868
Workers runtime tests                9 / 9
Report reliability tests             91 / 91
Dependency audit                     0 vulnerabilities
Wrangler deployment dry-run          PASS / no deployment
```

## Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

Storage/report flags do not implicitly enable schedules.

## Shared Storage authority

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

Names, Grain, Stable keys, metric semantics, indexes and UPSERT rules remain governed by `docs/project-brain/storage-architecture-and-migration-contract-v1.md`.

## Parallel Workstreams

```text
TikTok Organic       Draft PR #65 / this Integration stream
All Meta             separate Branch and Draft PR
YouTube Organic      separate Branch and Draft PR
Chatwoot             separate Branch and Draft PR
WooCommerce          separate Branch and Draft PR
Google Ads           completed / no duplicate implementation
```

Each Workstream must reuse Shared Core, own a unique Branch, avoid shared-file ownership collisions and leave Migration, deployment, Queue, Remote Lark/D1, schedules and LIVE UAT to the Integration stream.

## Next separate approval gate

No Live action is authorized by Draft PR #65. The later bounded rollout sequence is:

1. read-only Remote config/schema preflight;
2. Remote D1 backup;
3. additive Migration 0016 apply;
4. flags-false Worker deployment and route smoke;
5. guarded read-only RAW/D1/Canonical audit;
6. one manual freshness probe and new-watermark admission;
7. D1/Canonical/Coverage reconciliation;
8. Lark-primary + D1-shadow parity;
9. exact same-watermark rerun with zero Business drift;
10. D1-primary Report validation with Lark-primary rollback path;
11. only then propose controlled schedule activation.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no protected RAW mutation;
- no rerun of completed TikTok recovery operators;
- no duplicate Reliability/Queue/D1/Lark engine;
- Connector flags and schedules disabled by default;
- secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.
