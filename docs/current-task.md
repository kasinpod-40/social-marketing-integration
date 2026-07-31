# Current Task — Meta History Exact-Plan Continuation Recovery v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_HISTORY_EXACT_PLAN_CONTINUATION_V1
BRANCH                               = hotfix/meta-facebook-lark-continuation-v1
IMPLEMENTATION_PR                    = #372 / DRAFT / DO_NOT_MERGE
RETAINED_REPOSITORY_HEAD             = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
CURRENT_MAIN_BASE                    = c03ca9af7ddc0b8f72527419fc193eb49e1c590d
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
WORKER_FLAGS                         = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
FIRST_CI_HEAD                        = ba2aec24f71f1f1d045755fda24abd6049c623f8
FIRST_META_CI                        = #118 / INFRA_FAILURE_BEFORE_SETUP
FIRST_BRANCH_CI                      = #1504 / INFRA_FAILURE_BEFORE_SETUP
NEXT_STEP                            = EXACT_HEAD_CI_REVIEW_AND_MERGE
```

## Retained live evidence

The ninth Meta Terminal execution admitted the deterministic Facebook July operation. A later Terminal call
correctly stopped at `cloudflare-readiness` because Remote Reliability contained one active Work and one active
Queue operation.

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

The state did not change during the stability interval. Existing D1 facts and Queue admission are therefore
authoritative. Do not restart, replace, abandon or terminalize the Work.

## Recovery decision

The first required action is same-operation Lark continuation with the exact operation ID and original
requested-at generation. Facebook Provider read and Facebook D1 Queue send must not run again.

After Facebook Lark completion returns Reliability to idle, the remaining Instagram and Meta Ads operations
must continue from the persisted six-operation plan bound to the retained Head. Running the normal Terminal
from current main would create different deterministic operation identities and is prohibited.

## Implementation

The Hotfix adds:

```text
scripts/lib/meta-history-exact-plan-continuation.js
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
scripts/meta-history-2026-exact-plan-continuation.mjs
tests/application/meta-history-exact-plan-continuation.test.js
tests/application/meta-history-exact-plan-continuation-wiring.test.js
docs/tasks/meta-history-exact-plan-continuation-v1.md
```

The public Terminal supplies the retained private Safe config to the guarded continuation. The guarded
continuation:

1. requires clean current `main == origin/main` and explicit confirmation;
2. validates the exact retained Head, operation, generation, range and runtime plan;
3. permits only the exact reviewed Lark Dashboard and continuation release path set;
4. rejects any critical Meta/Worker/Queue/Lark-connector drift;
5. validates the retained D1 summary with the existing Lark contract;
6. verifies all-false Worker state and two stable Remote boundary reads;
7. creates an isolated local clone pinned as `main == origin/main == retained Head`;
8. reuses the retained private outputs/evidence;
9. runs only the Facebook Lark phase chain first;
10. blocks uncertain Queue acceptance and performs automatic all-false restore;
11. validates accepted Lark completion and same-operation idempotent rerun;
12. invokes the existing one-command finalizer inside the isolated retained-Head clone to resume the remaining
    persisted operations;
13. accepts success only from the existing `META_HISTORY_2026_COMPLETED_SAFE` final summary.

The implementation does not modify the current main Working Tree, `.dev.vars`, Remote D1, Lark, Queue,
Worker, Schedule or Production during Repository work and CI.

## Verification state

The first exact Head `ba2aec24f71f1f1d045755fda24abd6049c623f8` triggered Meta #118 and Branch
#1504. Both original jobs and one failed-job retry ended before `Set up job`; the Actions API returned zero
steps and no usable log blob. These are runner/infrastructure failures, not Source verdicts.

Manual review of that Head found and corrected two fail-closed release defects before Live execution:

1. the post-merge Repository delta must include the continuation Release files themselves; and
2. the public Terminal must use the retained private Safe config rather than depend on local
   `wrangler.sync.jsonc` file permissions.

A new exact Head must receive fresh Meta and Branch verification. No prior failed job is accepted as PASS.

## Acceptance criteria

```text
Exact retained operation/generation                    locked
Current-main reviewed release delta                    exact
Critical Meta Source drift                             0
Retained private Safe config                           public Terminal authority
Facebook Provider replay                               0
Facebook D1 Queue resend                               0
Facebook same-operation Lark continuation              accepted
Facebook Lark idempotent rerun                         accepted
Remaining retained operations                          completed
Final D1/Lark parity                                   pass
Final active Work / Lock / Queue                       0 / 0 / 0
Worker flags                                           all false
Schedule                                               disabled
Production                                             blocked
```

## Required verification

```text
npm ci
npm run check
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

No Live continuation may run before exact-head verification, review, Squash Merge and a docs-only execution
handoff. Detailed contract: `docs/tasks/meta-history-exact-plan-continuation-v1.md`.
