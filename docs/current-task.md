# Current Task — Report Metric Stable-Key Integrity v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PENDING
CURRENT_PROGRAM                     = REPORT_METRIC_STABLE_KEY_INTEGRITY_V1
BRANCH                              = hotfix/report-metric-stable-key-integrity-v1
EXACT_BASE                          = bc7a5375fecb279f1d9a4fc89b7c2d7ee081c84c
FAILED_RECOVERY_STAGE               = verify-d1-lark-integrity
FAILED_RECOVERY_CODE                = REPORT_RUNTIME_CLOSEOUT_LARK_INTEGRITY_NOT_CONVERGED
D1_MATERIALIZATION_COUNT            = 1
LARK_SNAPSHOT_COUNT                 = 1
LARK_METRIC_COUNT                   = 139
LARK_TOP_CONTENT_COUNT              = 0
REPORTED_DUPLICATE_METRIC_KEYS      = 114
INCIDENT_CLOSURE_ATTEMPTED          = false
QUEUE_ACTION_COUNT                  = 0
WORKER_DEPLOYMENT_COUNT             = 0
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION              = false
SCHEDULE_ENABLED                    = false
PRODUCTION                          = BLOCKED
```

## Goal

Correct the shared Report D1/Lark integrity verifier so dimensional Report rows are identified by the same stable `report_metric_key` used by the Lark writer and `TableSyncEngine`, rather than treating repeated business `metric_key` values across dimensions as duplicate Lark rows.

## Current incident

The post-PR #528 Chatwoot 1D direct recovery successfully wrote the retained D1 materialization to Lark before verification stopped:

```text
Snapshot rows             1
Metric rows               139
Top Content               0
Top Ads                   0
reported duplicate keys   114
Queue sends               0
Worker deployments        0
incident closure          not attempted
```

The failed evidence root is immutable:

```text
outputs/chatwoot-post-528-bc7a5375/chatwoot-1d-d1-lark-recovery
```

Do not rerun, delete, reset or clean this root.

The 139 Lark rows are retained evidence and must not be manually deleted, deduplicated or regenerated through Queue work.

## Root cause

`MKT_Report_Metric_Values` has two different identities with different jobs:

```text
metric_key          = business metric definition
report_metric_key   = stable physical Report row identity
```

Dimensional reports intentionally repeat one `metric_key` for different `dimension_type` / `dimension_value` rows. Chatwoot Inbox/Agent rows therefore repeat business metric names while remaining distinct stable rows.

The shared reviewed-state verifier incorrectly built its duplicate set and value map from `metric_key`:

```text
metric_key -> current_value
```

That collapsed valid dimensional rows and reported 114 false duplicates.

The writer already uses the correct stable identity:

```text
report_id
+ stableMetricKey
+ dimensionType
+ dimensionValue
= report_metric_key
```

## Correction

Change only the shared Report closeout/readback verifier:

- read `report_metric_key` from every Lark Metric row;
- duplicate detection applies to `report_metric_key`, not business `metric_key`;
- reconstruct expected stable row identities from the persisted D1 materialization using the same escaping and dimension defaults as `buildReportMetricValueRows()`;
- compare every stable row's current value with Lark using four-decimal Lark canonicalization already required by Report integrity;
- repeated business `metric_key` values across distinct dimensions are valid;
- duplicate `report_metric_key` remains a hard blocker;
- missing/extra stable rows or value drift remain hard blockers.

No Report formula, Lark writer, TableSyncEngine, Report ID, materialization payload or business metric semantics are changed.

## Required recovery boundary

After merge, use the existing exact Chatwoot D1/Lark recovery operator under a brand-new evidence root. Because Lark already contains the 139 stable rows, shared `TableSyncEngine.planByKey()` must converge by stable key and must not create duplicate business rows.

Required result:

```text
D1 materialization                  1
D1 payload/checksum                 unchanged
Retained Sync status                failed
Lark Snapshot                       1
Lark Metrics                        139
Duplicate report_metric_key         0
D1/Lark stable-key integrity        PASS
Retained DLQ                        closed/completed after integrity
Retained Critical Alert             resolved after integrity
Queue sends                         0
Worker deployments                  0
Provider requests                   0
Notification Admission              false
Schedule                            disabled
Production                          BLOCKED
```

## Prohibited actions

- rerun any failed evidence root;
- delete or manually deduplicate the existing 139 Lark rows;
- resend Chatwoot 1D Queue work;
- deploy a Report Worker;
- mutate the retained D1 materialization payload/checksum;
- create a replacement Report ID;
- close DLQ/Alert before stable-key D1/Lark integrity passes;
- change canonical Dashboard metric scopes;
- enable Notification Admission, Schedule or Production.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-closeout-stable-metric-integrity.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-state.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery-source.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run current-head Finalizer under a brand-new evidence root;
3. run exact Chatwoot D1/Lark recovery under a brand-new immutable root;
4. require retained D1 payload/checksum unchanged;
5. require Lark Snapshot `1`, Metrics `139`, duplicate stable key `0` and exact value parity;
6. close/read back only the exact retained DLQ + Critical Alert;
7. run fresh SELECT-only Chatwoot readiness;
8. derive 1D/3D/7D/30D continuation from fresh readback only.
