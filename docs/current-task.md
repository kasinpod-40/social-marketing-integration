# Current Task — Meta Ads 3D Queue Activation Continuation v2

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = META_ADS_3D_QUEUE_ACTIVATION_CONTINUATION_V2
BRANCH                              = hotfix/meta-ads-queue-activation-continuation-v2
EXACT_BASE                          = d3bbaa33fb51874609dae2abd04ab0cd25f36ea9
VERIFIED_IMPLEMENTATION_HEAD        = 6de4d7a3590116e04af4564bae859988161d8fbf
PR                                  = 515
BRANCH_VERIFICATION_RUN             = 31023528258
BRANCH_VERIFICATION_NUMBER          = 2243
META_END_TO_END_RUN                 = 31023529837
META_END_TO_END_NUMBER              = 450
PLATFORM                            = meta_ads
WINDOW                              = 3D
REPORT_ID                           = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
ORIGINAL_REQUESTED_AT               = 1785934718928
FAILED_RECOVERY_REQUESTED_AT        = 1785938483493
FAILED_CONTINUATION_REQUESTED_AT    = 1785943887248
D1_ROOT_CAUSE                       = ENTITY_BIND_LIMIT_CONFIRMED
QUEUE_ACTIVATION_FAILURE            = DASHBOARD_REPORT_CONFIGURATION_INVALID
PRIOR_SUCCESSFUL_SYNC_RUNS          = 2
FAILED_D1_SYNC_RUNS                 = 6
LATEST_ATTEMPT_SYNC_RUNS            = 0
TARGET_MATERIALIZATION_COUNT        = 0
OPEN_REPORT_DLQ                     = 3
ACTIVE_REPORT_WORK                  = 0
ACTIVE_REPORT_LOCK                  = 0
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/meta-ads-3d-queue-activation-continuation-v2.md
```

## Goal

Continue the exact retained Meta Ads 3D Report only after correcting the Shared Queue activation barrier. The latest
attempt used the original byte-stable job but was rejected before `sync_runs` with
`DASHBOARD_REPORT_CONFIGURATION_INVALID`; Notification Runtime was restored and no materialization, Work or lock was
created.

## Proven boundaries

### D1 reader defect — fixed

```text
1D  77 Ads + 3 = 80 bindings   PASS
3D 102 Ads + 3 = 105 bindings  FAIL
```

PR #512 removed broad Paid Ads projections and PR #513 added deterministic 97-ID chunks.

### Queue activation defect — corrected in PR #515

The active Worker version and Report flags passed the previous deployment verifier, but the exact Queue job was
terminalized before `runReliableSync`. The previous verifier checked Worker version/bindings only and used a 30-second
barrier; it did not inspect the actual Queue consumer inventory. The main Queue permits a 30-second batch wait.

Exact retained third DLQ:

```text
terminal:228fecb8afc03a3339313a85fbb5c45c
queue=social-mkt-sync-jobs
error=DASHBOARD_REPORT_CONFIGURATION_INVALID
main_queue_attempts=1
sync_runs=0
materialization=0
```

## Implementation result

Implemented on Draft PR #515 without Remote execution:

- retained the existing Report Finalizer, config window, deployment runtime, Queue sender, D1/Lark integrity and
  closure helpers;
- added GET-only Cloudflare Queue consumer inventory verification before Report send;
- requires exactly one `social-mkt-sync-worker` consumer with reviewed batch, concurrency, retry, wait and DLQ
  settings;
- changed only Report execution windows to three exact Worker-version samples over 120 seconds;
- preserved the Notification baseline restore barrier at three samples over 30 seconds;
- bound all three exact DLQs and the retained failed continuation attempt;
- retained exactly one original Queue send and one exact replay;
- closes all three DLQs only after D1/Lark integrity, replay stability and baseline restore;
- added focused Queue-consumer/barrier and three-DLQ continuation regressions;
- Repository Remote actions: zero.

Exact implementation Head `6de4d7a3590116e04af4564bae859988161d8fbf` passed:

```text
Branch Verification #2243 / run 31023528258
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

Meta End-to-End #450 / run 31023529837
Diff hygiene                                 PASS
Syntax architecture and repository hygiene  PASS
Focused Meta workstream tests                PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
```

## Acceptance criteria

1. Queue inventory contains exactly one reviewed Worker consumer and exact settings.
2. Active Report deployment remains the same exact version with exact bindings/flags for three samples across 120s.
3. Safe Notification restore retains three samples across 30s.
4. Current live state must contain exactly three bound open DLQs, six historical D1 failures, zero latest Sync Runs
   and an empty D1/Lark target before continuation.
5. The original Meta Ads 3D job is sent once; replay is sent only after first materialization succeeds.
6. D1 materialization count remains one; Report ID and payload checksum remain stable.
7. Lark snapshot/metrics/Top Ads integrity is unchanged on replay.
8. Notification Runtime is restored before all three DLQs close.
9. Provider requests remain zero; Notification Admission, Schedule and Production remain disabled.
10. Full Unit/Workers, Report reliability, Meta End-to-End, audit and Wrangler dry-run gates pass.

## Prohibited actions

- rerun any prior Run All, Recovery or continuation evidence root;
- generic Queue redrive/resend;
- manual D1/Lark materialization repair;
- Provider refresh;
- Notification Admission, AI, Schedule or Production activation;
- Dashboard legacy display-name backfill before 28-window closure.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-queue-activation-barrier.test.js
node --test tests/scripts/report-runtime-meta-ads-3d-d1-bind-continuation.test.js
node --test tests/connectors/d1-ads-report-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run exact-head Report Finalizer;
3. execute one new evidence root for Queue-activation continuation v2;
4. never repeat that root after a Queue send;
5. run fresh SELECT-only readiness;
6. continue only remaining windows through a new exact handoff;
7. repair `__mkt_legacy_display_name_single_select_v2` after all 28 windows close.
