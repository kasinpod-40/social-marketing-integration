# Current Task — Meta History Execution After Runtime Hotfix v2

## Status

```text
TASK_STATUS                   = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM               = META_HISTORY_2026_FINALIZER_V1
ORIGINAL_IMPLEMENTATION_PR    = #319 / SQUASH_MERGED
RUNTIME_HOTFIX_PR             = #330 / SQUASH_MERGED
RUNTIME_HOTFIX_MAIN_SHA       = f88cc46e33889386bc4593c118e28681e6c86ff1
RUNTIME_HOTFIX_REVIEW         = PASS_FOR_MERGE
META_VERIFICATION_RUN         = #98 / PASS
BRANCH_VERIFICATION_RUN       = #1390 / PASS
FACEBOOK_PINNED               = VERIFY_EXISTING_D1_LARK_NO_OPERATION_REPLAY
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PLANNED_OPERATION_COUNT       = 6
PREVIOUS_META_REMOTE_ACTIONS  = 0
WORKER_FLAGS                  = ALL_FALSE_VERIFIED
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
NEXT_STEP                     = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #330 corrected the two runtime-preflight failures and was Squash Merged at
`f88cc46e33889386bc4593c118e28681e6c86ff1`.

The final exact PR Head passed:

```text
Meta End-to-End Verification  run 30625892587 / #98 / PASS
Branch Verification           run 30625892589 / #1390 / PASS
Review threads                0
Branch behind main            0 before Squash Merge
Remote action during hotfix   0
```

The two previous Terminal attempts stopped before the first Meta operation. No Meta Queue message,
Provider request, Remote D1/Lark Business write or accepted history operation occurred. The retained
historical `sync_runs` rows were not deleted or edited.

## Runtime corrections

- A readable Wrangler source config, including a symlink resolving to a regular file, is accepted.
- The generated execution config remains private `0600` and has absolute Repository paths for `main` and
  `migrations_dir`.
- Active Queue execution is counted only when Queue attempts are linked to active durable Work.
- Historical `sync_runs` rows without active durable Work no longer block the Meta preflight.
- Worker-flag safety and Reliability-idle checks are independent.
- Emergency all-false deployment is authorized only when the exact active-flag assertion proves a Worker
  execution flag is enabled. Authentication, config, D1-read and idle-state errors do not trigger deploy.

## Execution scope

The public Terminal entrypoint performs the remaining controlled work:

- verify the completed pinned Facebook D1/Lark lane without replaying that operation;
- run one deterministic Facebook supplemental operation for July 1–31, 2026;
- run Instagram history for July 1–31, 2026;
- run Meta Ads history for May 1–July 31, 2026 for `chemistry_k2` and `chemistry_k3`;
- expand both Ads accounts to January 1–April 30 only when the bounded baseline gate permits;
- complete D1 before same-operation Lark continuation;
- prove D1/Lark parity and idempotent replay;
- restore every Worker execution flag false and require active Work/Lock/Queue counts `0/0/0`.

Stable Business keys preserve existing rows. Do not delete the previous runtime-plan or evidence
directories. The Terminal entrypoint will create or reuse evidence bound to the exact current merged Head.

## Public Terminal command

Run only from exact clean current `main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke `scripts/meta-history-2026-one-command.mjs`,
`scripts/meta-history-2026-finalizer.mjs`, D1/Lark phase launchers, or manual Queue sends.

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

Live completion is not declared until the Terminal emits the accepted decision and final safe-state
evidence.

Detailed implementation contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
Runtime recovery contract: `docs/tasks/meta-history-runtime-preflight-recovery-v2.md`.
