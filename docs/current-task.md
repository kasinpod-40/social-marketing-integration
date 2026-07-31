# Current Task — Meta History Execution After Pinned Continuity Recovery v3

## Status

```text
TASK_STATUS                   = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM               = META_HISTORY_2026_FINALIZER_V1
ORIGINAL_IMPLEMENTATION_PR    = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR   = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR   = #342 / SQUASH_MERGED
PINNED_CONTINUITY_MAIN_SHA    = ce59437dbb9e9325f743805af0f67ce5cf192c04
META_VERIFICATION_RUN         = 30629702372 / #105 / PASS
BRANCH_VERIFICATION_RUN       = 30629702378 / #1412 / PASS
LEGACY_LOCAL_META_ARTIFACTS   = NOT_REQUIRED
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PLANNED_OPERATION_COUNT       = 6
PREVIOUS_ATTEMPT_META_OPS     = 0
PREVIOUS_ATTEMPT_REMOTE_WRITE = 0
WORKER_FLAGS                  = ALL_FALSE_VERIFIED
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
NEXT_STEP                     = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #342 replaced the missing historical local clone/session dependency with exact current continuity
evidence and was Squash Merged at:

```text
ce59437dbb9e9325f743805af0f67ce5cf192c04
```

The exact PR Head `df2abaeda080441ed5f8faf306719d1cf07f2352` passed:

```text
Meta End-to-End Verification  run 30629702372 / #105 / PASS
Branch Verification           run 30629702378 / #1412 / PASS
Review threads                0
Branch behind main            0 before merge
Changed files                 7 / Meta scope only
Remote action during hotfix   0
```

The failed Terminal attempt that reported `META_HISTORY_2026_PINNED_FILES_MISSING` stopped before fresh
Meta identity validation and before all six history operations. It sent no Meta Queue message, made no
Meta Provider request, wrote no Remote D1/Lark Business fact and deployed no Worker. The Worker remained
all-false.

## Continuity contract now merged

The Terminal no longer requires or reads:

```text
MKT_META_FINALIZE_CLONE
MKT_META_FINALIZE_SESSION_FILE
MKT_META_FINALIZE_OVERLAY
MKT_META_FINALIZER_FILE
```

Instead it requires:

- a current read-only Summary with the expected contract, `status=passed`, no mutation, zero Business
  writes and zero Queue messages;
- exactly four current identity validations: Facebook, Instagram and both Meta Ads accounts;
- an exact six-operation target/range/mode/operation-ID plan bound to the current merged Head;
- no legacy operation ID, no old-operation replay and no replacement operation;
- one deterministic Facebook July supplemental operation;
- existing Shared D1-only then Lark parity continuation;
- canonical `larkParityVerified` and same-operation idempotency evidence;
- final all-false Worker flags and active Work/Lock/Queue counts `0/0/0`.

The old operation is retained only as a non-secret SHA-256 fingerprint. It is not recreated or executed.
Stable Business keys preserve existing Facebook and Lark facts.

## Execution scope

```text
Facebook continuity  fresh identity + exact no-replay plan
Facebook July        2026-07-01..2026-07-31
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31 for chemistry_k2 and chemistry_k3
Meta Ads optional    2026-01-01..2026-04-30 only under bounded baseline volume
```

The public Terminal entrypoint creates or reuses evidence under the exact current merged Head. Retain all
previous output directories; do not copy, delete or edit historical evidence.

## Public Terminal command

Run only from exact clean current `main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke `scripts/meta-history-2026-one-command.mjs`,
`scripts/meta-history-2026-finalizer.mjs`, D1/Lark phase launchers or manual Queue sends.

## Expected accepted result

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads May-July               complete for both accounts
Meta Ads January-April          conditional on bounded baseline volume
D1/Lark parity                  pass
Same-operation replay           pass
Active Work / Lock / Queue      0 / 0 / 0
Worker flags                    all false
Schedule                        disabled
Production                      blocked
```

Live completion is not declared until the Terminal emits the accepted decision and final safe-state
evidence.

Detailed implementation contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
Pinned continuity recovery contract: `docs/tasks/meta-history-pinned-continuity-recovery-v3.md`.
