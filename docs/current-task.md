# Current Task — Meta Ads 3D D1 Bind Exact Continuation v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = META_ADS_3D_D1_BIND_CONTINUATION_V1
BRANCH                              = hotfix/meta-ads-3d-d1-bind-continuation-v1
EXACT_BASE                          = 2f87f7f342847a5dcd0cf794cd0a74e55ab76068
VERIFIED_IMPLEMENTATION_HEAD        = 8f3ff8c425ce871f3d19ce70188e0c3e01a46c0a
PR                                  = 514
BRANCH_VERIFICATION_RUN             = 31019421705
BRANCH_VERIFICATION_NUMBER          = 2241
META_END_TO_END_RUN                 = 31019419506
META_END_TO_END_NUMBER              = 448
PLATFORM                            = meta_ads
WINDOW                              = 3D
REPORT_ID                           = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
ORIGINAL_REQUESTED_AT               = 1785934718928
FAILED_RECOVERY_REQUESTED_AT        = 1785938483493
ROOT_CAUSE                          = ENTITY_BIND_LIMIT_CONFIRMED
UNIQUE_ADS_1D                       = 77
UNIQUE_ADS_3D                       = 102
PRE_FIX_BINDINGS_1D                 = 80
PRE_FIX_BINDINGS_3D                 = 105
D1_BINDING_CEILING                  = 100
PRIOR_SUCCESSFUL_SYNC_RUNS          = 2
FAILED_RECOVERY_SYNC_RUNS           = 6
ORIGINAL_DLQ                        = terminal:e408707c9c2d383e04a3e213a7be45a0
RETRY_EXHAUSTED_DLQ                 = dlq:2f292f08f5bdc4f12c91b68ceff71e1b
TARGET_MATERIALIZATION_COUNT        = 0
ACTIVE_REPORT_WORK                  = 0
ACTIVE_REPORT_LOCK                  = 0
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/meta-ads-3d-d1-bind-continuation-v1.md
```

## Goal

Continue the exact retained Meta Ads 3D Report job after live SELECT-only evidence proved that the old entity lookup
used 105 total D1 bindings and exceeded the reviewed ceiling of 100. Do not rerun the failed Recovery evidence root
or the prior Run All handoff.

## Proven root cause

```text
1D  77 Ads + 3 = 80 bindings   PASS
3D 102 Ads + 3 = 105 bindings  FAIL
```

PR #512 removed broad unneeded Paid Ads projections. PR #513 merged deterministic 97-ID entity chunks into
`main@2f87f7f342847a5dcd0cf794cd0a74e55ab76068`. The exact live root cause is proven.

## Exact retained boundary

- original Report ID, requested-at, period, source watermark and job hash remain unchanged;
- failed recovery produced six failed Sync Runs and zero D1/Lark target rows;
- original configuration DLQ and retry-exhaustion DLQ remain open;
- no Report Work or lock is active;
- Notification Runtime baseline is restored;
- Notification Admission, Schedule and Production remain disabled.

## Implementation

One exact incident continuation operator reuses the existing Shared Finalizer, Notification-preserving Worker window,
Queue sender, D1/Lark state and integrity checks, Stable replay checks, D1 backup and exact DLQ closure pattern.

The operator:

1. requires clean `main`, an operator-supplied exact merged Head and exact-head Finalizer evidence;
2. binds the retained failed-recovery attempt and both inspector files;
3. binds both exact DLQs and operation metadata;
4. requires two prior successes, six failed recovery runs and an empty D1/Lark target;
5. sends the original Meta Ads 3D job once;
6. verifies one materialization and D1/Lark integrity;
7. sends one exact replay and proves no drift;
8. restores and stabilizes Notification Runtime;
9. closes both DLQs only after all prior proof passes;
10. emits a private sanitized summary.

Polling reports failed-attempt progress and stops after an exact new DLQ appears. It does not restore the Worker while
a Queue retry is merely between attempts.

## Out of scope

- rerun of `outputs/meta-ads-3d-exact-recovery-5b35861553d2`;
- rerun of the previous all-channel Run All root or handoff;
- generic Queue resend/redrive or DLQ deletion;
- replacement Report identity or requested-at;
- Provider/source refresh;
- manual D1/Lark materialization repair;
- remaining Meta Ads 7D/30D or later channels;
- `__mkt_legacy_display_name_single_select_v2` Dashboard backfill;
- Notification Admission, AI, Schedule or Production activation.

## Acceptance criteria

1. PR #513 fixed Head is an ancestor and the live command supplies the exact merged continuation Head.
2. Retained evidence proves `102 Ads / 105 bindings` for 3D and `77 Ads / 80 bindings` for 1D.
3. Both exact DLQ rows and metadata match the original Queue job.
4. Exactly one first Queue send and one replay send are possible.
5. Materialization count remains one and payload checksum remains stable.
6. D1/Lark integrity and Lark Stable rows remain unchanged on replay.
7. Preserved Notification Runtime baseline is restored with three stable samples.
8. Both DLQs close only after materialization, replay and restore proof.
9. Provider requests remain zero.
10. Notification Admission, Schedule and Production remain disabled.

## Implementation result

Implemented on Draft PR #514 without Remote execution:

- exact two-DLQ continuation contract and immutable root-cause evidence;
- one first send plus one exact replay only;
- exact-head environment guard for the post-merge Head;
- D1/Lark materialization, replay and baseline-restore gates;
- progress diagnostics and exact-new-DLQ termination;
- closure of both retained DLQs only after full success;
- focused pure-contract and source-wiring regressions;
- repository implementation Remote actions: zero.

Exact implementation Head `8f3ff8c425ce871f3d19ce70188e0c3e01a46c0a` passed:

```text
Branch Verification #2241 / run 31019421705
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

Meta End-to-End #448 / run 31019419506
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
3. execute the new Meta Ads 3D continuation once;
4. never repeat its evidence root after any Queue attempt;
5. run fresh SELECT-only readiness;
6. continue only the remaining windows under a new exact handoff;
7. repair the legacy Dashboard display field after all 28 windows close.
