# Current Task — Meta History Execution After Explicit Safe Flags Recovery v5

## Status

```text
TASK_STATUS                    = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM                = META_HISTORY_2026_FINALIZER_V1
ORIGINAL_IMPLEMENTATION_PR     = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR    = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR    = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR      = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR   = #348 / SQUASH_MERGED
EXPLICIT_SAFE_FLAGS_HOTFIX_PR  = #353 / SQUASH_MERGED
EXPLICIT_SAFE_FLAGS_MAIN_SHA   = 1548ea1c16bcc1283ddc49334af4929d566bb162
META_VERIFICATION_RUN          = 30635949978 / #113 / PASS
BRANCH_VERIFICATION_RUN        = 30635950002 / #1459 / PASS
PLANNED_OPERATION_COUNT        = 6
PREVIOUS_ATTEMPT_META_OPS      = 0
PREVIOUS_ATTEMPT_BUSINESS_WRITE= 0
PREVIOUS_ATTEMPT_QUEUE_MESSAGE = 0
WORKER_FLAGS                   = ALL_FALSE_VERIFIED
SCHEDULE                       = DISABLED
PRODUCTION                     = BLOCKED
NEXT_STEP                      = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #353 was Squash Merged at:

```text
1548ea1c16bcc1283ddc49334af4929d566bb162
```

The exact reviewed Head `bc42181356cd6bb84bc5c7b064c3264b6015ac2b` passed:

```text
Meta End-to-End Verification  run 30635949978 / #113 / PASS
Branch Verification           run 30635950002 / #1459 / PASS
Review threads                0
Branch behind main            0 before merge
Changed files                 6 / Meta scope only
Terminal executable mode      100755
Remote action during hotfix   0
```

## Fifth attempt retained

The prior Terminal attempt on `main@a0bbef75b0185ac55dba3a272eb925cfb1ea056b` stopped during
`fresh-read-only-validation` because `MKT_CONNECTOR_META_ADS_ENABLED` was absent rather than explicitly
`false`.

The attempt reported:

```text
businessWrites  0
queueMessages   0
```

It stopped before Provider validation and before every current history operation. The closeout verified the
Worker all-false state. No Queue admission, Provider request, Remote D1/Lark Business write, Worker
deployment, Schedule mutation or Production action occurred.

Retain every previous evidence directory. Do not delete, copy or edit prior output.

## Explicit Safe child environment now merged

Before the guarded child starts, the public Terminal now:

1. copies the caller environment without mutating it;
2. sets every existing `MKT_*_ENABLED` key to string `false`;
3. materializes every Shared `META_D1_ONLY_REQUIRED_FALSE_FLAGS` key as string `false`;
4. freezes the child environment;
5. spawns the guarded child with that environment instead of raw `process.env`.

This closes missing, stale and future execution flags before read-only validation. Later D1/Lark windows
remain controlled by the reviewed private Wrangler configs and restore all execution flags false.

## Retained execution scope

```text
Facebook continuity  fresh identity + exact no-replay plan
Facebook July        2026-07-01..2026-07-31
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31 for chemistry_k2 and chemistry_k3
Meta Ads optional    2026-01-01..2026-04-30 only under bounded baseline volume
```

The old local Meta clone/session/overlay/finalizer files remain unnecessary. Existing Business facts are
preserved through Stable keys. D1 completes before same-operation Lark continuation.

## Public Terminal command

Run only from exact clean current `main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke child launchers or send Queue messages manually.

## Expected accepted result

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads required               complete for both accounts
D1/Lark parity                  pass
Same-operation replay           pass
Active Work / Lock / Queue      0 / 0 / 0
Worker flags                    all false
Schedule                        disabled
Production                      blocked
```

Live completion is not declared until the Terminal emits the accepted decision and final safe-state
evidence.

Detailed recovery contract: `docs/tasks/meta-history-explicit-safe-flags-recovery-v5.md`.
