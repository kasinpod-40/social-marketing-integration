# Current Task — Chatwoot 1D Exact Report Incident Continuation v1

## Status

```text
TASK_STATUS                   = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM               = CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_V1
BRANCH                        = hotfix/chatwoot-1d-exact-incident-continuation-v1
EXACT_BASE                    = 50d32078f767b2acf779425e91efa9b2d606f322
VERIFIED_CODE_HEAD            = 1fec400642b6b3e06e638893ce8ea875db5915a5
PR                            = 523
BRANCH_VERIFICATION_RUN       = 31123060791
BRANCH_VERIFICATION_NUMBER    = 2263
FAILED_PLATFORM               = chatwoot
FAILED_WINDOW                 = 1D
REPORT_ID                     = integration_workspace:chatwoot:rolling:1d:chemistry_k:rolling_days:2026-08-01:2026-08-01:chatwoot-customer-service-v1
ORIGINAL_REQUESTED_AT         = 1786016588074
FAILED_SYNC_RUN               = 1c7a20b3-5bb7-45a3-b591-b71e392a02b6
FAILED_CODE                   = UNHANDLED_SYNC_ERROR
FAILED_MESSAGE                = Unsupported Dashboard metric scope: period_end_snapshot
MATERIALIZATION_COUNT         = 0
LARK_SNAPSHOT_METRIC_COUNT    = 0 / 0
OPEN_REPORT_DLQ_ALERT         = 1 / 1
ACTIVE_REPORT_WORK_LOCK       = 0 / 0
WORKER_BASELINE_VERIFIED      = true
EXPECTED_CONTINUATION_QUEUE   = 1
REMOTE_IMPLEMENTATION_ACTION  = 0
NOTIFICATION_ADMISSION        = false
SCHEDULE_ENABLED              = false
PRODUCTION                    = BLOCKED
```

Full contract:

```text
docs/tasks/chatwoot-1d-exact-incident-continuation-v1.md
```

## Goal

Continue only the exact retained Chatwoot 1D failed-before-write incident after PR #522, verify the complete D1/Lark materialization, restore the notification-only Worker baseline, then close only the bound DLQ and Critical Alert.

## Implementation result

Implemented on Draft PR #523 without Remote execution:

- reused the current-head Report Finalizer, reviewed Chatwoot runtime flags, Notification-preserving Worker window, Queue sender, D1/Lark state and integrity verifiers, D1 backup and exact metadata closure pattern;
- bound the exact original requested-at, Report ID, failed Sync Run, replay-payload-identical DLQ envelope and Critical Alert;
- separated exact Sync/Alert root-cause binding from the Queue terminal envelope so both original-error and `QUEUE_RETRY_EXHAUSTED` DLQs remain admissible only when payload and operation metadata match exactly;
- required Source facts `200/42`, Work/Lock `0/0`, open Report DLQ/Alert `1/1`, empty exact D1/Lark target and safe Worker baseline before deployment;
- limited the continuation to one exact Queue message;
- emitted progress approximately every 30 seconds and stopped immediately on a new failed Sync Run or exact new DLQ;
- required D1 materialization `1`, Lark Snapshot `1`, Metrics `139`, Top Content/Ads `0/0`, duplicate `0` and exact D1/Lark integrity;
- required verified notification-only Worker baseline restore before exact incident closure;
- closed only the bound DLQ and Alert after every integrity gate passes;
- rejected any started evidence root without a valid final summary;
- Repository Remote actions: zero.

Exact code Head `1fec400642b6b3e06e638893ce8ea875db5915a5` passed Branch Verification #2263 / run `31123060791`:

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
- use generic DLQ redrive or generic Alert closure;
- close the retained DLQ/Alert before D1/Lark integrity and Worker restore;
- send more than one Queue message in the exact incident continuation;
- touch WooCommerce Report materializations;
- add `period_end_snapshot` as a Dashboard/Lark option;
- enable Notification Admission, AI, Schedule or Production;
- perform Remote execution during implementation or CI.

## Acceptance criteria

1. Repository and Finalizer are bound to the exact merged main Head.
2. The original exact Chatwoot 1D Queue job is regenerated and matched to the retained DLQ replay payload.
3. Exactly one retained failed Sync Run, DLQ and Critical Alert are admitted.
4. Any Source/runtime/incident drift fails closed before deployment or Queue send.
5. A started evidence root cannot be rerun automatically.
6. New failure evidence terminates polling immediately; progress is visible while waiting.
7. Incident closure is impossible before D1 `1`, Lark `1/139`, duplicate `0`, exact integrity and Worker baseline restore.
8. Focused, full Unit/Workers, Report reliability, audit and Wrangler dry-run gates pass on the exact PR Head.
9. Repository implementation performs zero Remote action.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-chatwoot-1d-incident-continuation.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-dlq-envelope.test.js
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
2. run the current-head Finalizer under a new evidence directory;
3. run the exact Chatwoot 1D continuation once under a new immutable root;
4. require final D1/Lark/closure/baseline evidence to pass;
5. run fresh SELECT-only Chatwoot readiness;
6. continue Chatwoot 3D/7D/30D under a separate reviewed root;
7. run final Chatwoot readiness and Dashboard compatibility readback;
8. keep Notification Admission/Schedule disabled and Production blocked.
