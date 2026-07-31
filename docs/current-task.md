# Current Task — Meta History 2026 One-Command Execution

## Status

```text
TASK_STATUS                   = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM               = META_HISTORY_2026_FINALIZER_V1
IMPLEMENTATION_PR             = #319 / SQUASH_MERGED
IMPLEMENTATION_MAIN_SHA       = 0ae80e3809cda0a582d8cfc0715313f8ac191a45
IMPLEMENTATION_REVIEW         = PASS_FOR_MERGE
META_VERIFICATION_RUN         = #95 / PASS
BRANCH_VERIFICATION_RUN       = #1383 / PASS
WOOCOMMERCE                   = WOOCOMMERCE_2026_COMPLETED_SAFE
FACEBOOK_PINNED               = VERIFY_EXISTING_D1_LARK_NO_OPERATION_REPLAY
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PLANNED_OPERATION_COUNT       = 6
PINNED_META_HEAD              = e069380a544575ce0fc9bca53f1fb56944d26c09
PINNED_INSTAGRAM_OPERATION    = meta-instagram-d1-20260729t065939687z-1ad3c9
REPOSITORY_REMOTE_ACTIONS     = 0
WORKER_FLAGS                  = ALL_FALSE
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
NEXT_STEP                     = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #319 is merged. The reviewed implementation is available on `main` and passed both exact-head
workflows after alignment with the concurrent Report readiness recovery:

```text
Meta End-to-End Verification  run 30619391809 / #95 / PASS
Branch Verification           run 30619391794 / #1383 / PASS
Review threads                0
Branch behind main            0 before Squash Merge
Squash Merge SHA              0ae80e3809cda0a582d8cfc0715313f8ac191a45
```

Repository implementation and CI performed no Provider mutation, Queue send, Remote D1/Lark write,
Worker deployment, Schedule activation, Secret change or Production action.

## Execution scope

The single public Terminal entrypoint performs the remaining controlled Live work:

- verify the completed pinned Facebook D1/Lark lane without replaying that operation;
- run one separate deterministic Facebook supplemental operation for July 1–31, 2026;
- run Instagram history for July 1–31, 2026;
- run Meta Ads history for May 1–July 31, 2026 for `chemistry_k2` and `chemistry_k3`;
- expand both Ads accounts to January 1–April 30 only when the reviewed baseline volume gate permits;
- use the existing Shared Queue/Reliability, D1 writers, Coverage, Organic History Writer and
  TableSyncEngine;
- complete D1 before the same-operation Lark continuation;
- prove D1/Lark parity and idempotent replay;
- restore every Worker execution flag to false and require active Work/Lock/Queue counts `0/0/0`.

Stable Business keys preserve existing Facebook rows. The supplemental operation is not a replacement
operation and Business facts must not be deleted or directly mutated.

## Public Terminal command

Run only from the Repository root after updating to the exact current `origin/main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Only `scripts/meta-history-2026-terminal.mjs` is the public entrypoint. Do not run
`scripts/meta-history-2026-one-command.mjs`, `scripts/meta-history-2026-finalizer.mjs`, a D1/Lark phase
launcher or a Queue send command manually.

The Terminal entrypoint fails closed unless:

- the active branch is clean `main`;
- local `main` equals `origin/main` exactly;
- the private environment file is valid;
- the Worker is all-false and Reliability is idle;
- six deterministic operations have unique persisted ISO `originalRequestedAt` generations.

A recorded Queue attempt with uncertain acceptance blocks automatic resend. Do not delete evidence or
blindly rerun a child phase after a failure; retain the complete output for exact diagnosis.

## Expected accepted result

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook pinned completion        verified / no replay
Facebook July supplemental        complete
Instagram July                    complete
Meta Ads May-July                 complete for both accounts
Meta Ads January-April            conditional on safe baseline volume
D1/Lark parity                    pass
Same-operation replay             pass
Active Work / Lock / Queue        0 / 0 / 0
Worker flags                      all false
Schedule                          disabled
Production                        blocked
```

Live completion is not declared until the Terminal output contains the accepted decision and its final
safe-state evidence.

Detailed contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
