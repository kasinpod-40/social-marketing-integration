# Current Task — Chatwoot Retained Metric Scope Projection Compatibility v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PENDING
CURRENT_PROGRAM                     = CHATWOOT_RETAINED_METRIC_SCOPE_PROJECTION_COMPATIBILITY_V1
BRANCH                              = hotfix/retained-report-metric-scope-projection-v1
EXACT_BASE                          = 6fca9034d30b3e30aaf66c4d108e046d6dc531bb
FAILED_RECOVERY_STAGE               = write-existing-d1-materialization-through-shared-lark-writer
FAILED_RECOVERY_CODE                = REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_FAILED
FAILED_RECOVERY_MESSAGE             = Unsupported Dashboard metric scope: period_end_snapshot
D1_MATERIALIZATION_COUNT            = 1
LARK_SNAPSHOT_COUNT                 = 0
LARK_METRIC_COUNT                   = 0
LARK_WRITE_ATTEMPTED_FLAG           = true
INCIDENT_CLOSURE_ATTEMPTED          = false
QUEUE_ACTION_COUNT                  = 0
WORKER_DEPLOYMENT_COUNT             = 0
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION              = false
SCHEDULE_ENABLED                    = false
PRODUCTION                          = BLOCKED
```

## Goal

Recover the exact retained Chatwoot 1D D1 materialization whose persisted payload predates the canonical Chatwoot metric-scope correction, without rewriting that retained D1 payload/checksum and without weakening the canonical Dashboard metric-scope contract for new payloads.

## Root cause

The exact D1 materialization was created before PR #522 corrected Chatwoot period-end account metrics from legacy `period_end_snapshot` to canonical `current_total`.

The retained D1 row is valid historical evidence and its checksum protects the exact old JSON. `D1ReportMaterializationReader` intentionally validates that checksum before parsing. During direct Lark recovery, `writeDashboardMaterializationToLark()` then forwards the retained metric definitions to `buildReportMetricValueRows()`, whose canonical `normalizeDashboardMetricScope()` correctly rejects `period_end_snapshot`.

The latest recovery therefore failed before `TableSyncEngine.executePlan()` and before incident closure. It must not be rerun under the same evidence root.

Immutable failed evidence:

```text
outputs/chatwoot-post-527-6fca9034/chatwoot-1d-d1-lark-recovery
```

## Correction

Extend the existing exact Chatwoot D1/Lark recovery in place.

Immediately after the retained materialization is checksum-validated and read, create an in-memory projection copy with this exact compatibility mapping:

```text
period_end_snapshot -> current_total
```

Rules:

- mapping applies only inside the exact Chatwoot retained-materialization recovery operator;
- original D1 `payload_json`, `payload_checksum`, row identity and Sync history are not modified;
- canonical `normalizeDashboardMetricScope()` is still the final validator;
- unknown scopes still fail closed;
- the compatibility path requires at least one proved legacy-scope rewrite, otherwise recovery fails;
- dimension metrics already using canonical `period_delta` remain unchanged;
- after Lark projection, reread D1 and require byte-identical payload/checksum and identical retained runtime state before integrity verification;
- exact DLQ/Critical Alert closure remains after D1 immutability + D1/Lark integrity verification only.

## Required recovered state

```text
D1 materialization                  1
D1 payload/checksum                 unchanged
Retained Sync status                failed
Successful Sync count               0
Lark Snapshot                       1
Lark Metrics                        139
Lark Top Content                    0
Lark Top Ads                        0
Duplicate metric keys               0
Projected legacy scope              current_total
Canonical global alias relaxation   none
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

- rerun any failed recovery evidence root;
- rewrite the retained D1 payload or checksum;
- regenerate/replacement-write the Report materialization;
- globally accept `period_end_snapshot` as a canonical Dashboard scope;
- resend Queue work;
- deploy a Report Worker;
- rewrite the historical failed Sync Run;
- close DLQ/Alert before D1 immutability and Lark integrity pass;
- enable Notification Admission, Schedule or Production.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery-source.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-incident-continuation.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run a current-head Finalizer under a brand-new evidence root;
3. run the corrected exact Chatwoot D1/Lark recovery once under a brand-new immutable root;
4. require in-memory legacy rewrite count > 0 and persisted materialization unchanged;
5. require D1 `1`, Lark `1/139`, duplicate `0`, integrity PASS, Queue `0`, Worker deployment `0`;
6. close/read back exact retained DLQ + Critical Alert;
7. run fresh SELECT-only Chatwoot readiness;
8. derive 1D/3D/7D/30D actions from fresh readback only.
