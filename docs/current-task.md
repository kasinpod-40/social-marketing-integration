# Current Task — Meta History Explicit Safe Flags Recovery v5

## Status

```text
TASK_STATUS                    = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                = META_HISTORY_EXPLICIT_SAFE_FLAGS_RECOVERY_V5
BASE_MAIN_SHA                  = 34de702ae9c3b7f6952687ae97338cc50a4aedad
BRANCH                         = hotfix/meta-history-2026-explicit-safe-flags-v5
IMPLEMENTATION_PR              = #353 / DRAFT / DO_NOT_MERGE
ORIGINAL_IMPLEMENTATION_PR     = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR    = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR    = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR      = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR   = #348 / SQUASH_MERGED
PLANNED_OPERATION_COUNT        = 6
FIFTH_ATTEMPT_META_OPERATIONS  = 0
FIFTH_ATTEMPT_BUSINESS_WRITES  = 0
FIFTH_ATTEMPT_QUEUE_MESSAGES   = 0
WORKER_FLAGS_AFTER_ATTEMPT     = ALL_FALSE_VERIFIED
SCHEDULE                       = DISABLED
PRODUCTION                     = BLOCKED
NEXT_STEP                      = EXACT_HEAD_VERIFICATION_REVIEW_AND_MERGE
```

## Fifth Live failure retained

The Terminal attempt on `main@a0bbef75b0185ac55dba3a272eb925cfb1ea056b` passed local gates,
private-config preparation, Cloudflare readiness and Remote safe-state verification. It then stopped at
`fresh-read-only-validation` before the first Provider validation:

```text
code       META_READ_ONLY_VALIDATION_UNSAFE_FLAGS
fieldName  MKT_CONNECTOR_META_ADS_ENABLED
```

The read-only operator reported:

```text
businessWrites  0
queueMessages   0
```

The outer closeout verified the Remote Worker all-false state. No current Meta operation, Queue admission,
Provider request, Remote D1/Lark Business write, Worker deployment, Schedule mutation or Production action
occurred.

Retain every prior evidence directory. Do not delete, copy or edit prior output.

## Root cause

The public Terminal passed `process.env` directly to the guarded child. The finalizer later closed only
`MKT_*_ENABLED` keys that already existed in `.dev.vars` or the shell environment. A newly required Safe
flag that was absent remained `undefined`.

The read-only contract correctly requires each reviewed execution flag to be explicitly `false`; it does
not accept a missing value. Therefore an absent `MKT_CONNECTOR_META_ADS_ENABLED` caused a false preflight
block even though no execution flag was active.

This is a launcher environment-materialization defect, not a credential, Meta mapping or Remote-state
failure.

## Correction

The public Terminal now builds the child environment before starting the one-command child:

1. copy the caller environment without mutating it;
2. set every existing `MKT_*_ENABLED` key to string `false`;
3. materialize every flag from the Shared `META_D1_ONLY_REQUIRED_FALSE_FLAGS` authority as string `false`;
4. freeze the resulting child environment;
5. spawn the guarded child with that environment instead of raw `process.env`.

The Shared list is a superset of the read-only requirements and is also the authority used by the Meta D1
safe-config gate. This prevents the same missing-flag class from reappearing in the read-only, D1 or Lark
continuation sequence.

Explicit Safe materialization does not enable any connector or mutation path. Later D1/Lark phases still
activate only their exact reviewed config window and restore all flags false.

## Main alignment

PR #353 is based directly on `main@34de702ae9c3b7f6952687ae97338cc50a4aedad` and retains the concurrent
Chatwoot Worker Secret staging hotfix unchanged. The Meta PR changes only its six scoped files.

## Acceptance criteria

```text
Missing MKT_CONNECTOR_META_ADS_ENABLED     materialized false
Every Shared Meta required-false flag      explicit string false
Existing unknown MKT_*_ENABLED key         forced false
Non-flag environment values                preserved
Caller environment object                  not mutated
Child spawn environment                     safe materialized object
Raw env: process.env child spawn             forbidden
Read-only unsafe-flag regression             PASS
Meta End-to-End Verification                 PASS required
Branch Verification                          PASS required
Terminal executable mode                     100755 required
Remote action during implementation/CI        0
```

## Public command boundary

Do not rerun the Terminal command while PR #353 is unmerged. After exact-head CI, review, Squash Merge and
a docs-only execution handoff, the only public entrypoint remains:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke child launchers or send Queue messages manually.

Detailed recovery contract: `docs/tasks/meta-history-explicit-safe-flags-recovery-v5.md`.
