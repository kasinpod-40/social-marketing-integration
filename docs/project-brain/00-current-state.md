# 00 — Current State

## Current release candidate

`v0.7.1-report-reliability-hardening` — 2026-07-12

## Live-complete scope

- TikTok Creator Organic ingestion to `MKT_Content` and cumulative `MKT_Content_Daily`.
- Live DEV gate, canonical keys, idempotency, reconciliation, Sync Log, D1 distributed lock, retry/DLQ/System Alerts.
- Scheduled + incremental TikTok sync with D1 cursor/fingerprint and 24-hour full reconciliation.

## v0.7.1 reliability gate completed in code

- Report first-write failures are `failed`; partial status requires actual confirmed/unknown write progress.
- Scheduler binds TikTok `metricDate` and report `periodEnd` to the original scheduled time.
- Top Content uses one bounded limit and neutralizes stale ranks after a limit reduction.
- Expired leases fail closed; chunk guard failures preserve prior progress; Lark 1254290 stays a retryable rejection.
- Local lock mutations are guarded; local Wrangler config must not be tracked.
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
