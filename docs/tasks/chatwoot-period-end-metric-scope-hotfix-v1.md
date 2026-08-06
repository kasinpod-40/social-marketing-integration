# Chatwoot Period-End Metric Scope Hotfix v1

## Incident

The first reviewed Chatwoot 1D Report Queue delivery failed before any Report materialization write.

```text
REPORT_ID              = integration_workspace:chatwoot:rolling:1d:chemistry_k:rolling_days:2026-08-01:2026-08-01:chatwoot-customer-service-v1
SYNC_STATUS            = failed
ERROR_CODE             = UNHANDLED_SYNC_ERROR
ERROR_MESSAGE          = Unsupported Dashboard metric scope: period_end_snapshot
RECORDS_WRITTEN        = 0
OPEN_REPORT_DLQ        = 1
OPEN_REPORT_ALERT      = 1
ACTIVE_WORK            = 0
ACTIVE_LOCK            = 0
WORKER_BASELINE        = verified safe
PRODUCTION             = BLOCKED
```

The stopped evidence root is immutable and must never be rerun:

```text
outputs/final-woo-chatwoot-closeout-e9ab36e88526/closeout/chatwoot-1d-3d-7d-30d
```

## Root cause

The shared Dashboard metric scope contract accepts exactly:

```text
period_delta
current_total
data_quality
```

Chatwoot summary generation emitted the non-canonical value `period_end_snapshot` for Account metrics whose aggregation is `latest_completed_day_value`. The shared Report row builder correctly rejected that value before D1/Lark materialization.

## Correction

Map Chatwoot period-end Account snapshot metrics to the existing canonical `current_total` scope.

This is semantically correct because these metrics are cumulative/current Account state observed on the latest completed day inside the Report period. It also preserves the existing Lark SingleSelect schema and Dashboard grouping contract.

Do not:

- add `period_end_snapshot` to the shared Dashboard or Lark Select options;
- change Report IDs, metric keys, formulas, values, ranks or Stable keys;
- close/redrive the retained DLQ or Alert during implementation;
- resend the failed Queue job;
- deploy Worker or mutate Remote D1/Lark;
- enable Notification Admission, AI, Schedule or Production.

## Regression

The focused regression must prove:

1. Chatwoot event metrics remain `period_delta`.
2. Chatwoot `latest_completed_day_value` metrics become `current_total`.
3. No Chatwoot payload emits `period_end_snapshot`.
4. The shared `buildReportMetricValueRows` path accepts all 19 summary metrics and preserves the canonical scopes.
5. Existing Dashboard scope options remain unchanged.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-report-materialization.test.js
node --test tests/application/chatwoot-report-dimension-metrics.test.js
node --test tests/connectors/d1-chatwoot-report-source.test.js
node --test tests/application/multichannel-report-runtime.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge incident continuation

A separately authorized exact-incident continuation must:

1. synchronize clean exact merged `main`;
2. run the current-head Finalizer without adding a metric-scope option;
3. prove the retained failed Chatwoot 1D job, DLQ and Alert identities;
4. run the exact retained 1D job once under a new immutable evidence root;
5. verify D1 materialization `1`, Lark Snapshot `1`, Metrics `139`, duplicate keys `0` and exact integrity;
6. close only the retained DLQ and Alert after successful integrity readback;
7. continue 3D/7D/30D under another reviewed root;
8. restore and verify the notification-only Worker baseline;
9. keep Notification Admission and Schedule disabled and Production blocked.
