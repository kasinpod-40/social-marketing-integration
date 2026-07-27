# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

Historical Root Project Brain ก่อน TikTok post-Lark implementation ถูกเก็บแบบ immutable ที่:

```text
docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md
```

## Current verified repository state — 2026-07-27

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
TikTok post-Lark pipeline                     merged via PR #65
TikTok pipeline merge commit                  acb0b76bb3be936319e0e8bed4849592c96761b5
TikTok guarded rollout operator               merged via PR #71
TikTok operator merge commit                  e6b8bd0b9098b9a79bae49ff24455187e43a331e
TikTok operator reviewed head                 df229ccade82ce7869c01bbf75c1cb3fc0f16cd1
TikTok operator final verification            #558 PASS
Meta end-to-end implementation                merged via PR #69
Meta implementation merge commit              11e861cfbc79ea067a90496b205f692ca8bb4d3d
YouTube end-to-end integration                merged via PR #85
YouTube integration merge commit              dce3bd954ee75ee55a29efac303e9973ca060fca
YouTube reviewed head                         c5ffc4327ffec405f82472c7b7098b45bac82722
YouTube final verification                    #581 PASS
Migration 0016                                source only / not applied remotely
Worker deployment                             not run for TikTok or YouTube rollout
Queue send / DLQ redrive                      none for TikTok or YouTube rollout
Remote D1 / Lark mutation                     none for TikTok or YouTube rollout
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

## Merged guarded rollout operator

PR `#71` added an operator for these separately confirmed phases:

```text
plan
preflight
backup
migrate
deploy-safe
enable-audit
audit
disable-audit
```

The operator:

- defaults to plan-only;
- locks the exact Integration Workspace, Chemistry K source, D1 and Worker identity;
- requires a checksum-verified backup before Migration `0016`;
- validates exactly pending Migration `0016` and additive post-migration count parity;
- permits only Audit HTTP during the audit-only deployment;
- validates route state `404 → 401 → 200 → 404`;
- retains `readyForManualProcessing=false` as diagnostic evidence;
- preserves emergency safe-close when the authenticated Audit fails;
- contains no Queue send, DLQ action, Business write, schedule, retention/delete or Production path.

Final aligned Branch Verification `#558` passed after the merged Meta implementation was included.

Detailed operator closeout:

```text
docs/project-brain/tiktok-post-lark-rollout-operator-merge-closeout-2026-07-27.md
```

## Merged YouTube Organic integration

PR `#85` merged the reviewed YouTube End-to-End implementation and the Integration-owned Shared Worker wiring. Shared routing now selects the D1-first End-to-End route only when the dedicated gate is explicitly true:

```text
YouTube job + MKT_YOUTUBE_END_TO_END_ENABLED=true
  → dedicated D1-first route

YouTube job + flag false/unset
  → existing active router and legacy YouTube route

Non-YouTube job
  → existing Google Ads/TikTok/History/Active chain unchanged
```

The merge reuses the existing YouTube API client, Shared Google OAuth Core, normalizers, Reliability runner, distributed lock, resumable work, Organic history writer, D1 stores, Coverage and `TableSyncEngine`. No duplicate Connector, Queue, Reliability, D1, Lark or Report engine was created.

The merged implementation includes bounded large-inventory storage, retry-safe Coverage, fail-closed report reads, non-destructive missing/private/deleted handling, hidden-subscriber `null` semantics, and D1-before-Lark ordering. YouTube Analytics period facts remain in `RAW_YouTube_Analytics_Daily`; no new migration was added.

Detailed records:

```text
docs/tasks/youtube-organic-end-to-end.md
docs/tasks/youtube-organic-end-to-end-integration-review.md
docs/tasks/youtube-organic-integration-wiring-safe-rollout.md
```

Remote schema inspection, Worker deployment, Provider calls, Queue messages, D1/Lark Business writes, schedules and LIVE UAT remain blocked pending separate authorization.

## Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
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
TikTok Organic       pipeline PR #65 merged / rollout operator PR #71 merged / Remote rollout pending
All Meta             implementation PR #69 merged / protected runtime wiring remains separate Draft work
YouTube Organic      integration PR #85 merged / Remote read-only preflight pending
Chatwoot             separate Draft PR
WooCommerce          separate Draft PR
Google Ads           complete / safely closed
```

Each remaining Workstream owns a unique Branch and Draft PR. Migration, deployment, Queue sends, Remote Lark/D1 mutation, schedules and LIVE UAT remain Integration-stream responsibilities only.

## Next separately approved TikTok rollout

Repository tooling is merged, but no Remote phase is authorized automatically. The next order is:

1. run the operator plan from an authorized local Integration Workspace runtime;
2. execute read-only Remote configuration/schema preflight;
3. retain and review sanitized evidence;
4. authorize Remote D1 backup separately;
5. authorize additive Migration `0016` separately;
6. authorize flags-false Worker deployment separately;
7. authorize temporary audit-only deployment and one authenticated audit separately;
8. restore all-flags-false Worker state immediately;
9. only after a clean audit, consider one manual new-watermark Admission;
10. reconcile D1/Canonical/Coverage;
11. validate Lark-primary + D1-shadow parity and exact rerun stability;
12. validate D1-primary with an immediate Lark-primary rollback path;
13. only then propose controlled schedule activation.

## Next separately approved YouTube rollout

The Repository implementation is merged, but no Remote phase is authorized automatically. The next order is:

1. authenticated read-only verification that Storage Foundation `0009` tables exist;
2. inspect deployed configuration and confirm every YouTube/Storage/Report/Schedule flag is false;
3. retain and review sanitized evidence;
4. separately authorize an all-flags-false Worker deployment;
5. separately authorize a dry-run/read-only YouTube operation;
6. verify non-dry execution is blocked while D1 or Lark gate is false;
7. separately authorize controlled Integration Workspace D1-first/Lark UAT;
8. verify Coverage, idempotent rerun and D1 Report shadow parity;
9. keep Schedule and Production blocked until a new explicit approval.

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
