# Dashboard Rolling Period Presets and Custom Range

## Ownership

เอกสารนี้แยกจาก `docs/current-task.md` เพราะไฟล์กลางกำลังถือครองโดย YouTube Lark
Full-Sync UAT workstream. งานนี้ใช้ branch
`codex/dashboard-rolling-period-presets` และห้ามรวม Working Tree/Branch กับ workstream อื่น

## Objective

ทำ Shared Dashboard period contract ให้รองรับ Rolling completed days แบบ 3D, 7D, 9D,
15D, 30D, 90D และ queued `CUSTOM_RANGE` โดย D1 เป็น Historical source of truth,
Dashboard/Lark อ่าน Materialized results และ Preset ไม่กลายเป็น Report type แยกต่อจำนวนวัน

## In scope

- Shared `rolling_days` / `custom_range` resolver, inclusive dates และ equal previous period
- Default `period_end` เป็นเมื่อวานตาม Reporting timezone
- Deterministic `report_materializations` Stable key
- Watermark-bound Custom request admission ผ่าน `report_requests` และ existing Queue/Lock path
- Existing TikTok D1-aware Organic calculator/output writer
- Shared Ads SUM-then-ratio calculator และ Coverage/data-status semantics
- Repository-only Lark Dashboard binding รวม `MKT_Report_Top_Ads`
- Unit, Integration, Workers-runtime และ Report reliability regression

## Out of scope

- Remote D1 migration/apply, Worker deployment, Queue send, Lark mutation, Schedule/Cron
- Dashboard UI Live Apply, Connector/LIVE UAT, AI Summary, Notification, Retention/Delete
- Production, Secret หรือ Production configuration

## Contract

- Presets: `3, 7, 9, 15, 30, 90` inclusive completed days; 30D ไม่ใช่ Calendar month
- Period kinds: `rolling_days`, `custom_range`
- Comparison default: `previous_period` ที่มีวันเท่ากัน
- Custom range สูงสุด 366 inclusive days และห้ามจบหลัง last completed reporting day
- Organic cumulative: end observation ลบ pre-period baseline; old content without baseline
  เป็น `partial`; content ใหม่ในช่วงใช้ baseline `0`
- Ads: SUM daily facts ก่อนคำนวณ CTR/conversion rate/ROAS/video-view rate
- Missing metric คง `null`; observed zero คง `0`
- Request ID ผูก customer/account/platform/setting/formula/dates/comparison/source watermark
- Materialization ID ใช้ approved Stable key:
  `report_setting_key:account_key:period_kind:period_start:period_end:formula_version`

## Migration decision

`NONE`. Migration `0009_storage_foundation.sql` มี `report_materializations`,
`report_requests`, `period_kind`, `window_days`, comparison, coverage และ lifecycle columns
ครบแล้ว. Migration ล่าสุดบนฐาน `main` คือ `0018_chatwoot_analytics.sql`

## Implementation result

Status: `LARK_SETTINGS_RECONCILED_LIVE_POSTCHECK_PASS`

### Files changed

- Core period/materialization/request/Ads contracts:
  - `packages/application/src/reports/report-period.js`
  - `packages/application/src/reports/report-materialization.js`
  - `packages/application/src/reports/dashboard-report-request.js`
  - `packages/application/src/reports/calculate-ads-period-metrics.js`
- Existing Report/Queue/D1 runtime reuse:
  - `packages/application/src/use-cases/generate-tiktok-organic-report.js`
  - `packages/application/src/use-cases/generate-tiktok-organic-report-d1-aware.js`
  - `packages/application/src/jobs/job-catalog.js`
  - `packages/connectors/src/d1-report-request-store.js`
  - `packages/connectors/src/tiktok/d1-tiktok-report-request-store.js`
  - `apps/sync-worker/src/tiktok-d1-aware-report-job-router.js`
  - `apps/sync-worker/src/active-job-router.js`
- Repository-only Dashboard/Lark contract:
  - `packages/config/src/dashboard-report-blueprint.js`
  - `packages/config/src/lark-table-config.js`
  - `packages/config/src/lark-report-schema.js`
  - `packages/config/src/report-settings.seed.js`
  - `packages/application/src/reports/load-report-setting.js`
  - `packages/application/src/use-cases/reconcile-dashboard-report-settings.js`
  - `scripts/reconcile-dashboard-report-settings.mjs`
- Tests:
  - `tests/application/dashboard-report-contract.test.js`
  - `tests/application/report-period.test.js`
  - `tests/application/generate-tiktok-organic-report-d1-aware.test.js`
  - `tests/application/job-catalog.test.js`
  - `tests/connectors/d1-tiktok-post-lark-stores.test.js`
  - `tests/config/dashboard-report-blueprint.test.js`
- Documentation:
  - `docs/tasks/dashboard-rolling-period-presets-and-custom-range.md`
  - `PROJECT_BRAIN.md`
  - `CHANGELOG.md`

### Contracts implemented

- Rolling 3/7/9/15/30/90D และ bounded Custom resolver พร้อม timezone-completed-day gate
- Equal inclusive previous-period comparison และ 1D/7D backward compatibility
- One shared `report.materialization.generate` job type; ไม่มี job type แยกต่อ Preset
- Preset job builder และ Custom request admission ที่ claim ก่อน Queue send
- Shared cross-platform D1 request lifecycle พร้อม TikTok compatibility adapter
- Deterministic watermark-bound Custom request ID และ approved materialization Stable key
- TikTok D1-primary Organic custom/preset reuse ผ่าน existing calculator, Lark writer,
  Queue consumer และ Reliability lock
- Ads SUM-before-ratio, revision-compatible input, null/zero และ Coverage status semantics
- Repository binding/blueprint ของ Snapshots, Metric Values, Top Content และ Top Ads
- Canonical `integration_workspace` settings สำหรับ compatibility 1D/7D, rolling
  3/7/9/15/30/90D และ Custom โดยใช้ `period_kind`/`window_days`
- Shared `dashboard_performance_report` option ใน Settings และ Materialized output tables
- Exact-key legacy reconciliation สร้าง Canonical rows ก่อน Disable
  `dev_ft_pumkin`/`uat_chemistry_k`; ไม่มี Record delete

### Commands and tests run

- Initial focused period/request/materialization/TikTok/Ads/config suites — 38/38 PASS
- Focused Lark settings/schema/runtime/reconciliation suites — 42/42 PASS
- `npm ci` — PASS; locked dependencies installed
- `npm run check` — PASS
- `npm test` — Node 1,299/1,299 PASS; sandbox blocked Workers listener/log only
- `npm run test:worker` outside restricted sandbox — 12/12 PASS
- `npm run test:report-reliability` — 100/100 PASS
- `npm audit` — PASS; 0 vulnerabilities
- `npm run deploy:dry-run` — PASS for API and Sync Worker configs; no deployment
- `git diff --check` — PASS
- Live Lark guarded Preview — PASS; exact schema actions 9, active legacy settings 2,
  historical references 27, mutations 0
- Guarded Lark Apply — PASS; schema actions 9, Canonical creates 9, legacy disables 2,
  deletes 0
- Read-only post-apply verification — PASS; schema actions 0, Canonical creates/updates 0/0,
  Canonical skips 9, active legacy 0, historical references retained 27

### CI result

- Draft PR #195 Branch Verification #870, run `30349520673` — PASS
- Verified correction head: `b6e121d6aa154057da4e32a9e154612428ec3ade`
- Final documentation-only CI rerun pending

### Remaining gaps

- External UI/HTTP producer is not implemented or authorized.
- Other platform adapters can reuse the shared period/request/materialization/Ads contracts;
  only the existing TikTok D1-aware Organic adapter is active in this workstream.

### Remote actions

- Lark schema actions: 9 additive/option updates
- Canonical Report Settings created: 9
- Legacy Report Settings disabled: 2
- Report setting/history deletes: 0
- Remote D1, Worker, Queue, Schedule, Secret and Production actions: `NONE`

### Merge recommendation

Keep Draft until independent review is complete; corrected Branch Verification and guarded
Lark reconciliation both pass. Do not deploy or perform Remote D1/Queue/Schedule actions
from this PR.
