# Current Task — Meta History Exact-Plan Execution Handoff v2

## Status

```text
TASK_STATUS                          = META_HISTORY_EXACT_PLAN_EXECUTION_READY
CURRENT_PROGRAM                      = META_HISTORY_EXACT_PLAN_CONTINUATION_V1
IMPLEMENTATION_PR                    = #372 / SQUASH_MERGED
IMPLEMENTATION_MAIN_SHA              = 4261795b648d6494c1717f26c93f9acc34b81a16
CHATWOOT_DELTA_HOTFIX_PR             = #378 / SQUASH_MERGED
CHATWOOT_DELTA_HOTFIX_MAIN_SHA       = e0ba76b54b32a7d3739e83d64ff02d2a0e75c94f
VERIFIED_CHATWOOT_DELTA_HEAD         = 1242592676295d0c79997faa2cadd4e174d7cce4
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_ORIGINAL_REQUESTED_AT       = 2026-07-31T16:51:11.017Z
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_WORK_LIFECYCLE              = ACTIVE
FACEBOOK_ACTIVE_LOCKS                = 0
FACEBOOK_QUEUE_OPERATION_ROWS        = 1
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
PREVIOUS_CONTINUATION_STAGE          = exact-clean-current-main
PREVIOUS_CONTINUATION_REMOTE_ACTIONS = 0
META_VERIFICATION                    = run 30681619809 / #142 / PASS
BRANCH_VERIFICATION                  = run 30681619821 / #1547 / PASS
REVIEW_THREADS                       = 0
WORKER_FLAGS                         = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = RUN_EXACT_PLAN_CONTINUATION_TERMINAL_ONCE
```

## Retained live evidence

The ninth Meta history execution admitted the deterministic Facebook July operation. A later ordinary Terminal
call correctly stopped at `cloudflare-readiness` because Remote Reliability contained one active Work and one
active Queue operation.

Two read-only identity snapshots proved the exact active identity:

```text
work_key      facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
work_type     facebook.page.organic.sync
operation_id  meta-facebook-history-20260701-20260731-1d12a5ec4fef
lifecycle     active
queue rows    1
```

A separate exact-operation diagnostic performed zero writes and proved a stable D1-complete/Lark-pending
boundary across two reads:

```text
sync_run_status               success
sync_run_error_code           null
D1 phase                      complete
source staging phase          complete
organicHistoryDone            true
D1 written count              3
operation account daily rows  1
Coverage runs / invalid       2 / 0
Active lock                   0
Lark phase count              0
Completion phase count        0
```

The retained D1 facts and existing Queue admission are authoritative. Do not restart, replace, abandon,
terminalize or resend the Facebook Work.

## First guarded continuation stop

The first post-merge exact-plan continuation attempt stopped at `exact-clean-current-main` before any Provider,
Queue, Remote D1, Remote Lark, Worker, Schedule or Production action.

The guard correctly rejected five current-main paths introduced by the already-reviewed Chatwoot source-config
recovery in PR #373:

```text
.github/workflows/branch-verification.yml
docs/tasks/chatwoot-final-source-config-recovery-v1.md
scripts/chatwoot-final-source-config-recovery-launcher.mjs
scripts/lib/chatwoot-final-source-config-recovery.js
tests/application/chatwoot-final-source-config-recovery.test.js
```

PR #378 adds exactly these five paths to the retained-Head release allowlist and extends the fail-closed
regression. It does not change the Meta operation identity, original generation, D1/Lark boundary, critical
Meta path set or execution behavior.

## Recovery decision

The first required action remains same-operation Lark continuation using the exact operation ID and original
requested-at generation. Facebook Provider read and Facebook D1 Queue send must not run again.

After Facebook Lark completion returns Reliability to idle, the remaining Instagram and Meta Ads operations
must resume from the persisted six-operation plan bound to the retained Repository Head. The ordinary Meta
Terminal would create a different deterministic plan identity and remains prohibited for this incident.

## Merged implementation

PR #372 adds the guarded recovery boundary:

```text
scripts/lib/meta-history-exact-plan-continuation.js
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
scripts/meta-history-2026-exact-plan-continuation.mjs
scripts/verify-meta-history-exact-plan-continuation-local.mjs
tests/application/meta-history-2026-public-launcher.test.js
tests/application/meta-history-exact-plan-continuation.test.js
tests/application/meta-history-exact-plan-continuation-wiring.test.js
docs/tasks/meta-history-exact-plan-continuation-v1.md
```

The public Terminal supplies the retained private Safe config to the guarded continuation. The guarded
continuation:

1. requires clean current `main == origin/main` and explicit one-time confirmation;
2. validates the exact retained Head, operation, generation, range and persisted runtime plan;
3. requires the exact 33-path reviewed current-main Release delta;
4. rejects any unreviewed path or critical Meta, Worker, Queue or Lark-connector drift;
5. validates the retained D1 summary through the existing Lark acceptance contract;
6. verifies all-false Worker state and two stable Remote boundary reads;
7. creates an isolated local clone pinned as `main == origin/main == retained Head`;
8. reuses the retained private outputs and evidence without editing prior evidence;
9. runs only the Facebook same-operation Lark chain first;
10. blocks blind resend when Queue acceptance is uncertain;
11. restores and verifies all Worker execution flags false after an active Lark window;
12. validates accepted Facebook Lark completion and same-operation idempotent rerun;
13. invokes the retained one-command finalizer inside the isolated retained-Head clone to resume the remaining
    persisted operations; and
14. accepts completion only from the existing `META_HISTORY_2026_COMPLETED_SAFE` final summary.

## Verification authority

The exact Chatwoot-delta Hotfix Head `1242592676295d0c79997faa2cadd4e174d7cce4` passed both required workflows:

```text
Meta End-to-End Verification  run 30681619809 / #142 / PASS
Branch Verification           run 30681619821 / #1547 / PASS
Review threads                0
Branch behind main            0 before merge
Changed files                 2 / allowlist and regression only
```

Passed gates include:

```text
Locked dependency install
Diff and Repository hygiene
Syntax and architecture audit
Focused Meta continuation tests
Focused Woo completed-state race recovery tests
Focused Chatwoot final UAT and source-config recovery tests
Focused staged TikTok tests
Full Unit and Workers runtime tests
Report reliability regression
Dependency audit
Wrangler deployment dry-run
```

Implementation, review and CI performed no Provider request, Queue send, Remote D1 mutation, Remote Lark
mutation, Worker deployment, Schedule change or Production action.

## Public execution command

Run exactly once from the clean current `main` checkout:

```bash
CONFIRM_META_HISTORY_EXACT_CONTINUATION=CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY \
node scripts/meta-history-2026-exact-plan-continuation-terminal.mjs --execute
```

Do not run the ordinary Meta Terminal, D1/Lark child launchers or a manual Queue command. Do not modify
`.dev.vars`, prior evidence, lifecycle state or business facts.

If the command stops after any deployment, Queue-attempt marker or confirmed Lark write, do not blindly rerun.
Inspect the exact emitted stage, code and retained evidence first. The continuation itself is responsible for
same-operation resume and automatic all-false restoration.

## Expected accepted result

```text
META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE
retainedRepositoryHead       5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
operationId                  meta-facebook-history-20260701-20260731-1d12a5ec4fef
providerReplayForFacebook    false
d1QueueResendForFacebook     false
facebookLarkCompleted        true
finalDecision                META_HISTORY_2026_COMPLETED_SAFE
executionFlagsAllFalse       true
activeWork                   0
activeLocks                  0
activeQueueOperations        0
scheduleEnabled              false
production                   BLOCKED
```

Live completion is not declared until the command emits the accepted decision and final safe-state evidence.
Detailed contract: `docs/tasks/meta-history-exact-plan-continuation-v1.md`.
