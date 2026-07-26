# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

Historical Root Project Brain ก่อน TikTok post-Lark implementation ถูกเก็บแบบ immutable ที่:

```text
docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md
```

## Current verified repository state — 2026-07-26

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
TikTok post-Lark implementation               merged via PR #65
TikTok merge commit                           acb0b76bb3be936319e0e8bed4849592c96761b5
Reviewed PR head                              5d596d78753f29284667853c46fe87865701ff7e
Final Branch Verification                    #522 PASS
Migration 0016                                source only / not applied remotely
Worker deployment                            not run
Queue send / DLQ redrive                     none
Remote D1 / Lark mutation                    none
Schedules                                     disabled
Retention/delete                              blocked
Production                                    blocked
Google Ads                                    LIVE UAT complete / safely closed
```

## TikTok Organic identity and protected source

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
source=lark_native_tiktok_for_creator
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. Runtime may read it but must not mutate its Table, Fields, Views, Formula, Filter or Records.

Retained last verified Live facts:

```text
RAW_TikTok_Creator_Videos             approximately 2021
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                2021
D1 duplicate State/Observation groups 0 / 0
MKT_Content                           22 at last verified audit
MKT_Content_Daily                     208 at last verified audit
```

These counts are historical evidence, not a new freshness claim. New Live facts require the guarded read-only audit.

## Merged TikTok post-Lark architecture

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

No second TikTok connector, Reliability stack, Queue/DLQ framework, D1 history writer, Canonical writer, Lark sync engine or Report formula engine was created.

## Merged implementation capabilities

PR `#65` added:

- deterministic protected-RAW watermark probing and settling;
- exact Chemistry K identity validation;
- additive `tiktok_source_admissions` Migration `0016`;
- same-watermark idempotent admission and stable Work identity;
- exact staged-watermark verification before Business writes;
- D1 Organic Report history over State/Observation/Coverage with more than 800 identities;
- missing `null`, observed-zero and correction semantics;
- Lark/D1 shadow parity and fail-closed D1-primary gate;
- Coverage-gated post-processing Report admission;
- guarded GET-only operator audit at `/operator/tiktok/post-lark-audit`;
- optional deterministic Report materialization preparation.

Final Branch Verification `#522` passed:

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

Storage and Report flags never implicitly enable schedules.

## Shared Core authority

All channel Workstreams must reuse:

- central Connector and Job catalogs;
- deterministic Stable keys and exact identity validation;
- existing Queue/DLQ and operation identity helpers;
- existing Reliability runner, lock renewal and typed retry classification;
- D1 history/Coverage contracts and Storage Foundation;
- existing Canonical Lark writer and `TableSyncEngine`;
- existing Report calculations, materialization and output writers;
- sanitized observability with no Secret or raw customer payload exposure.

Do not create a parallel Reliability, Queue, D1 writer, Lark sync or Report engine.

## Parallel Workstreams

```text
TikTok Organic       merged PR #65 / Integration rollout pending
All Meta             separate Branch and Draft PR
YouTube Organic      separate Branch and Draft PR
Chatwoot             separate Branch and Draft PR
WooCommerce          separate Branch and Draft PR
Google Ads           complete / safely closed
```

Each Workstream owns a unique Branch and Draft PR. Migration, deployment, Queue sends, Remote Lark/D1 mutation, schedules and LIVE UAT remain Integration-stream responsibilities only.

## Next separately approved TikTok rollout

Merge does not authorize Runtime actions. The exact order is:

1. read-only Remote configuration and schema preflight;
2. Remote D1 backup;
3. additive Migration `0016` apply;
4. flags-false Worker deployment and route smoke;
5. guarded read-only RAW/D1/Canonical audit;
6. manual freshness probe and one new-watermark admission;
7. D1/Canonical/Coverage reconciliation;
8. Lark-primary + D1-shadow parity;
9. exact same-watermark rerun with zero Business drift;
10. D1-primary Report validation with Lark-primary rollback;
11. only then propose controlled schedule activation.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no protected RAW mutation;
- no rerun of completed TikTok recovery operators;
- no duplicate Reliability/Queue/D1/Lark/Report engine;
- Connector flags and schedules disabled by default;
- Secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.
