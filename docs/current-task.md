# Current Task — Chatwoot Period-End Metric Scope Hotfix v1

## Status

```text
TASK_STATUS                  = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM              = CHATWOOT_PERIOD_END_METRIC_SCOPE_HOTFIX_V1
BRANCH                       = hotfix/chatwoot-period-end-metric-scope-v1
EXACT_BASE                   = e9ab36e88526d849435eb36405f6fdb135c3505c
VERIFIED_CODE_HEAD           = c63bb6b79bc9569d1af1efbaf03b57927ea02144
PR                           = 522
BRANCH_VERIFICATION_RUN      = 31112628708
BRANCH_VERIFICATION_NUMBER   = 2260
FAILED_PLATFORM              = chatwoot
FAILED_WINDOW                = 1D
FAILED_STAGE                 = first reviewed Queue delivery before materialization write
FAILED_CODE                  = UNHANDLED_SYNC_ERROR
FAILED_MESSAGE               = Unsupported Dashboard metric scope: period_end_snapshot
RECORDS_WRITTEN              = 0
OPEN_REPORT_DLQ              = 1
OPEN_REPORT_CRITICAL_ALERT   = 1
ACTIVE_REPORT_WORK           = 0
ACTIVE_REPORT_LOCK           = 0
WORKER_BASELINE_VERIFIED     = true
REMOTE_IMPLEMENTATION_ACTION = 0
NOTIFICATION_ADMISSION       = false
SCHEDULE_ENABLED             = false
PRODUCTION                   = BLOCKED
```

Full contract:

```text
docs/tasks/chatwoot-period-end-metric-scope-hotfix-v1.md
```

## Goal

Repair the exact Shared Dashboard metric-scope mismatch that rejected Chatwoot Account period-end snapshot metrics before D1/Lark materialization.

## Root cause

The shared Dashboard/Lark contract accepts `period_delta`, `current_total` and `data_quality`. Chatwoot emitted the non-canonical `period_end_snapshot` value for metrics aggregated as `latest_completed_day_value`.

## Implementation result

Implemented on Draft PR #522 without Remote execution:

- mapped Chatwoot period-end Account snapshot metrics to canonical `current_total`;
- kept event, eligible-count and duration metrics as `period_delta`;
- preserved Report identity, metric keys, values, comparisons, dimensions and Stable keys;
- preserved the existing Shared Dashboard scope options and Lark schema;
- added an end-to-end regression through `buildReportMetricValueRows` proving that all 19 Chatwoot summary metrics use accepted canonical scopes;
- retained the failed Chatwoot 1D DLQ and Critical Alert unchanged for exact post-merge incident continuation;
- Repository Remote actions: zero.

Exact code Head `c63bb6b79bc9569d1af1efbaf03b57927ea02144` passed Branch Verification #2260 / run `31112628708`:

```text
Install locked dependencies                 PASS
Syntax architecture and hygiene             PASS
Focused Report source readiness tests       PASS
Focused Meta history finalizer tests         PASS
Focused Woo completed-state race tests       PASS
Focused Chatwoot final UAT tests              PASS
Focused staged TikTok tests                  PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
Diff whitespace check                        PASS
```

## Prohibited actions

- rerun `outputs/final-woo-chatwoot-closeout-e9ab36e88526/closeout/chatwoot-1d-3d-7d-30d`;
- close, resolve, redrive or discard the retained Chatwoot DLQ/Alert during implementation;
- resend a Queue message;
- deploy Worker or mutate Remote D1/Lark;
- add `period_end_snapshot` as a new Dashboard/Lark option;
- change Notification Admission, AI, Schedule, Secrets or Production.

## Acceptance criteria

1. No Chatwoot Report payload emits `period_end_snapshot`.
2. `latest_completed_day_value` maps to `current_total`.
3. Event, eligible-count and duration metrics remain `period_delta`.
4. The shared Report row builder accepts all 19 Chatwoot summary metrics.
5. Existing Dashboard scope options and Lark schema remain unchanged.
6. Focused, full Unit/Workers, Report reliability, audit and Wrangler dry-run gates pass on the exact PR Head.
7. Repository implementation performs zero Remote action.

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

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run current-head Finalizer without adding a metric-scope option;
3. bind the retained failed 1D Sync Run, DLQ and Alert exactly;
4. continue the exact 1D incident once under a new immutable evidence root;
5. require D1 `1`, Lark Snapshot `1`, Metrics `139`, duplicate `0` and exact integrity;
6. close only the exact retained DLQ/Alert after successful readback;
7. complete 3D/7D/30D under a new reviewed root;
8. verify the notification-only Worker baseline and keep Production blocked.
