# Current Task — Meta Ads 3D Report DLQ Recovery & Queue Completion Barrier v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = META_ADS_3D_REPORT_DLQ_RECOVERY_V1
BRANCH                              = fix/meta-ads-3d-dlq-recovery-v1
EXACT_BASE                          = 0db4c297d25678b8996033e2b0fdc29aae886c03
VERIFIED_IMPLEMENTATION_HEAD        = e2444e07f6e013c06414f748a5131a04ed3a737c
PR                                  = 511
BRANCH_VERIFICATION_RUN             = 31010888650
BRANCH_VERIFICATION_NUMBER          = 2234
META_END_TO_END_RUN                 = 31010890458
META_END_TO_END_NUMBER              = 441
FAILED_PLATFORM                     = meta_ads
FAILED_WINDOW                       = 3D
FAILED_REPORT_ID                    = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
EXACT_OPEN_REPORT_DLQ               = terminal:e408707c9c2d383e04a3e213a7be45a0
DLQ_ERROR_CODE                      = DASHBOARD_REPORT_CONFIGURATION_INVALID
DLQ_RETRY_COUNT                     = 4
TARGET_MATERIALIZATION_COUNT        = 0
PRIOR_META_ADS_SUCCESSFUL_RUNS      = 2
ACTIVE_REPORT_WORK                  = 0
ACTIVE_REPORT_LOCK                  = 0
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_RUNTIME_STATE          = active
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/meta-ads-3d-report-dlq-recovery-v1.md
```

## Goal

Recover only the exact Meta Ads 3D Report job that was admitted during the reviewed Run All but remained queued
past the prior two-minute success-only polling window, was then consumed under the restored baseline configuration
and reached the DLQ after four attempts. Extend the existing exact configuration-DLQ recovery authority to this
incident and keep future Run All Active Report windows open for a bounded 120 polls before restoration.

## Confirmed incident

Exact SELECT-only evidence proves:

```text
requestedAt                 1785934718928
reportId                    integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
DLQ                         terminal:e408707c9c2d383e04a3e213a7be45a0
messageId                   e408707c9c2d383e04a3e213a7be45a0
job SHA-256                 cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d
retry/main attempts         4 / 4
error                       DASHBOARD_REPORT_CONFIGURATION_INVALID
materialization             0
successful Meta Ads runs    2
active Work/Lock            0 / 0
open Report DLQ             1
Worker baseline             restored active Notification Runtime
```

The two successful Meta Ads runs are the completed 1D first delivery and exact replay. The 3D first-attempt local
evidence exists, while the 3D target remains empty in D1 and Lark. Generic Run All repetition is forbidden.

## Root cause

`pollD1Completion()` waited a default 24 polls at five seconds each. The third Meta Ads Queue delivery was not
observed within that two-minute window. The executor then entered `finally` and restored the preserved Worker
baseline. The still-queued 3D job subsequently reached a Worker without the reviewed D1-primary Report flags and
was retried four times into the DLQ.

This is a Queue completion-window race, not a source, Report identity, D1/Lark writer or Provider defect.

## Root correction

- reuse and generalize the existing exact configuration-DLQ recovery contract;
- retain the completed Facebook 1D incident and its `v1` Contract/closure reference unchanged;
- add one immutable Meta Ads 3D incident authority bound to exact local attempt, Queue payload hash, DLQ,
  operation metadata, source Coverage and empty D1/Lark target;
- run the exact original job once and the exact same job once for replay;
- use the existing stable Active deployment barrier, D1/Lark integrity proof and preserved baseline restore;
- close only the exact Meta Ads 3D DLQ and metadata after complete success;
- extend Run All child completion polling to 120 polls unless an explicit reviewed override exists.

## Out of scope

- rerunning the failed Run All block or reusing its handoff;
- redriving the DLQ generically;
- replacing requested-at, Report ID or Queue payload;
- modifying Meta Ads 1D or any Facebook/Instagram/YouTube materialization;
- Provider/source refresh;
- manual D1/Lark repair;
- Dashboard legacy-display backfill;
- Notification Admission, Schedule or Production activation.

## Acceptance criteria

1. The exact Meta Ads 3D incident resolves from a fixed incident key and rejects every identity/hash/count drift.
2. The preflight requires complete Meta Ads Coverage, D1 Ads facts, zero Work/Lock, one exact open Report DLQ and
   an empty 3D D1/Lark target.
3. Prior successful Meta Ads run floor is exactly two before recovery.
4. Recovery deploys the reviewed Active Report window and verifies three stable deployment samples.
5. Recovery submits the exact retained job once, proves one materialization and D1/Lark integrity, then submits the
   exact same job once and proves Stable ID/checksum/Lark/integrity replay.
6. Preserved Notification Runtime baseline is restored and verified before exact DLQ closure.
7. Run All propagates a bounded 120-poll completion barrier to each shared channel child.
8. Existing Facebook recovery and all shared Report regressions remain passing.
9. Provider requests remain zero; Notification Admission, Schedule and Production remain disabled.

## Implementation result

Implemented on Draft PR #511 without Remote execution:

- generalized the existing configuration-DLQ incident validators without adding a second recovery engine;
- added the exact Meta Ads 3D incident authority and recovery routing;
- retained the original Facebook `v1` recovery Contract and closure authority unchanged;
- extended the shared Run All child polling budget from 24 to 120 polls;
- added focused multi-incident and Run All barrier regressions;
- no Remote action was performed by Repository implementation.

Exact implementation Head `e2444e07f6e013c06414f748a5131a04ed3a737c` passed:

```text
Branch Verification #2234 / run 31010888650
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

Meta End-to-End #441 / run 31010890458
Diff hygiene                                 PASS
Syntax architecture and repository hygiene  PASS
Focused Meta workstream tests                PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
```

## Required verification

```bash
npm ci
npm run check
node --test \
  tests/scripts/report-runtime-reviewed-config-dlq-recovery.test.js \
  tests/scripts/report-all-ready-channels.test.js \
  tests/scripts/report-runtime-closeout-reviewed-state.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge boundary

1. synchronize clean exact merged `main`;
2. rerun exact-head Report Runtime Finalizer;
3. run the exact Meta Ads 3D configuration-DLQ recovery once;
4. never repeat it after any recovery attempt evidence exists;
5. run SELECT-only readiness for all seven ready channels;
6. build a fresh exact-head retained handoff and resume only the remaining windows;
7. after all 28 windows pass, repair the Dashboard legacy display-name compatibility field through the Shared Lark
   writer/backfill workstream.
