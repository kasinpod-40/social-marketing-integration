# 00 — Current State

## Current release candidate

`v0.8.2-lark-number-formatter-fix` — 2026-07-13

## Live-complete scope

- TikTok Creator Organic ingestion to `MKT_Content` and cumulative `MKT_Content_Daily`.
- Live DEV gate, canonical keys, idempotency, reconciliation, Sync Log, D1 distributed lock, retry/DLQ/System Alerts.
- Scheduled + incremental TikTok sync with D1 cursor/fingerprint and 24-hour full reconciliation.


## v0.8.2 Lark Number Formatter Fix

- Number field formatter ใช้ OpenAPI enum `1,000` และ `0.0000`
- Legacy aliases `#,##0` / `#,##0.0000` ถูก normalize ที่ Shared contract ก่อนส่ง API
- Apply รอบ v0.8.1 ล้มที่ Action แรก (`appliedActionCount=0`) จึงไม่ต้อง rollback
- Report schedules ยังคงปิดจน Schema Apply, Seed และ Manual UAT ผ่าน

## v0.8.1 Lark Report Schema Installer Safety Fix

- Plain Preview is read-only even if `CONFIRM_WRITE=YES` exists in the shell.
- Apply requires `CONFIRM_WRITE=YES npm run setup:report-schema:apply`.
- Checkbox and other propertyless fields omit `property`; Date/Select payloads use canonical OpenAPI keys.
- Installer failures include the failed action and prior applied-action count; rerunning Preview resumes any partially completed v0.8.0 run safely.

## v0.8.0 Lark Report Schema Installer

- Installer covers 5 Report tables and 110 fields, resolves by local Table ID or alias, and is safe to rerun.
- Missing Table/Field/Select options are added without deleting existing schema.
- Type mismatch and unresolved configured IDs block writes.
- Report schedules remain disabled pending Live Schema/Seed/UAT.

## v0.7.2 completed-period release gate

- Daily/Weekly report jobs use the previous completed local day from the original `scheduledTime`; month/year/leap-day boundaries are regression-tested.
- Report first-write failures are `failed`; partial status requires actual confirmed/unknown write progress.
- Scheduler derives TikTok `metricDate` from the local scheduled day and report `periodEnd` from the previous completed local day, preserving both across retries.
- Top Content uses one bounded limit and neutralizes stale ranks after a limit reduction.
- Expired leases fail closed; chunk guard failures preserve prior progress; Lark 1254290 stays a retryable rejection.
- Local lock mutations are guarded; orphan guard cleanup follows `../local-file-lock-guard-runbook-v0.7.2.md`; local Wrangler config must not be tracked.
- DEV example enables persisted Worker logs and traces.

## Implemented in code, pending Lark schema and Live UAT

- TikTok Daily/Weekly Organic Report Engine.
- Cumulative-period delta and previous-period comparison.
- New-content zero baseline, partial-baseline quality state, negative platform correction preservation.
- Weighted average watch time and completion rate.
- Idempotent `MKT_Report_Snapshots`, normalized `MKT_Report_Metric_Values`, and fixed-rank `MKT_Report_Top_Content` writes.
- Metric/report-setting seed jobs.
- Timezone-aware Daily/Weekly scheduled report producers.
- Report reliability accounting through the same D1 lock/log/retry/DLQ layer.

Daily and Weekly report schedule flags remain disabled until the latest Lark Base is changed according to the v0.7.0 Blueprint and Live DEV UAT passes.

## Client-facing rule

Clients should not use RAW tables, `MKT_Content_Daily`, Sync Log, System Alerts, cursor, lock, or technical IDs as normal working views. These are system/audit data. Client roles should use the Report Metric and Top Content views produced by Step 7.

## Next gate

See `10-next-actions.md` and `../tiktok-organic-report-blueprint-v0.7.0.md`.
