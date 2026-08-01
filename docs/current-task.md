# Current Task — Meta Retained D1 Summary Materialization Recovery v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_RETAINED_D1_SUMMARY_MATERIALIZATION_V1
BRANCH                               = hotfix/meta-retained-d1-summary-materialization-v1
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
LATEST_CONTINUATION_STAGE            = load-retained-evidence
LATEST_CONTINUATION_CODE             = ENOENT
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
WORKER_FLAGS                         = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_LOCAL_EVIDENCE_RECOVERY
```

## Retained live boundary

The deterministic Facebook July operation remains the same admitted operation:

```text
work_key      facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
work_type     facebook.page.organic.sync
operation_id  meta-facebook-history-20260701-20260731-1d12a5ec4fef
lifecycle     active
queue rows    1
```

Two prior read-only snapshots proved a stable D1-complete/Lark-pending boundary:

```text
sync_run_status               success
sync_run_error_code           null
D1 phase                      complete
source staging phase          complete
organicHistoryDone            true
Coverage runs / invalid       2 / 0
Active lock                   0
Lark phase count              0
Completion phase count        0
```

Existing D1 facts and the existing Queue admission are authoritative. Do not restart, replace, abandon,
terminalize or resend this Facebook operation.

## Latest guarded stop

The merged exact-plan continuation passed the reviewed Repository-delta guard and then stopped at
`load-retained-evidence` because this local file was absent:

```text
outputs/meta-d1-only-rollout/facebook/
meta-facebook-history-20260701-20260731-1d12a5ec4fef/summary.json
```

The stop occurred before Cloudflare context resolution, Provider request, Queue send, Remote D1/Lark mutation,
Worker deployment or Schedule action.

The missing file is the final local D1 operator summary. It cannot be replaced with a JSON assembled only from
the Remote D1 snapshot because the Lark gate requires the original evidence-chain head, accepted idempotent
rerun and verified all-false restore.

## Repository correction

The exact-plan public Terminal is extended to recover only the missing local summary when all retained D1 phase
evidence files are present:

```text
plan.json
preflight.json
backup.json
deploy-safe-baseline.json
verify-safe-baseline.json
deploy-d1-only-gates.json
verify-d1-only-deployment.json
snapshot-before.json
send-one-d1-only.json
verify-d1-only.json
resend-same-operation.json
verify-idempotent-rerun.json
restore-all-false.json
verify-restore.json
```

The recovery:

1. requires clean current `main == origin/main`;
2. validates the exact retained-Head release delta and zero Meta-critical drift before writing local evidence;
3. requires the complete ordered phase list;
4. validates every evidence hash and previous-evidence link with the existing D1 operator contract;
5. requires exact Facebook operation, generation, period, Work key and Sync-run identity from `plan.json`;
6. requires the chain to end at `verify-restore` with mode `safe` and zero expected true flags;
7. creates the final `summary` through `createMetaD1OnlyEvidence()` using the validated chain head;
8. validates the generated summary through `validateMetaD1OnlySummaryForLark()`;
9. writes `summary.json` atomically as a private local file; and
10. then delegates to the existing guarded exact-plan continuation.

The materialization path contains no `fetch`, Wrangler command, Provider read, Queue send, D1 command, Lark
request, Worker deployment or Schedule mutation. If any phase file is missing, invalid or chain-broken, it stops
and reports the exact missing/invalid evidence before the continuation child starts.

## Scope

Changed files:

```text
scripts/lib/meta-history-exact-plan-continuation.js
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
tests/application/meta-history-exact-plan-continuation.test.js
tests/application/meta-history-exact-plan-continuation-wiring.test.js
docs/current-task.md
```

No new public script, Runtime flag, Queue operation, migration, Worker route, Lark schema or Production path is
introduced.

## Required verification

```text
Syntax / architecture / Repository hygiene
Focused exact-plan contract tests
Focused exact-plan wiring tests
Full Unit and Workers runtime tests
Report reliability regression
Dependency audit
Wrangler deployment dry-run
Review threads = 0
Branch behind main = 0
```

Repository implementation and CI must perform:

```text
Provider requests          0
Queue sends                0
Remote D1 mutations        0
Remote Lark mutations      0
Worker deployments         0
Schedule mutations         0
Production                 BLOCKED
```

## Public command after review and merge

Only after the exact Hotfix Head passes all gates and is Squash Merged, run the same public entrypoint once from
clean current `main`:

```bash
CONFIRM_META_HISTORY_EXACT_CONTINUATION=CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY \
node scripts/meta-history-2026-exact-plan-continuation-terminal.mjs --execute
```

Do not run the ordinary Meta Terminal, D1/Lark child launchers or manual Queue commands. Do not edit
`.dev.vars`, prior evidence, lifecycle state or Business facts.

## Expected local recovery marker

When the D1 summary was absent and the retained chain is complete, the Terminal must emit:

```text
META_HISTORY_RETAINED_D1_SUMMARY_MATERIALIZED
providerReplay             false
queueResend                false
remoteD1MutationCount      0
remoteLarkMutationCount    0
workerDeploymentCount      0
```

It must then continue through the existing guarded path. Live completion is not declared until the final output
contains:

```text
META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE
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
