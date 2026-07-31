# Current Task — Meta History Pinned Continuity Recovery v3

## Status

```text
TASK_STATUS                   = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM               = META_HISTORY_PINNED_CONTINUITY_RECOVERY_V3
BASE_MAIN_SHA                 = 9d79e45676600831e1cc2fd7ca358a3176c55295
BRANCH                        = hotfix/meta-history-2026-pinned-continuity-v3
IMPLEMENTATION_PR             = #342 / DRAFT / DO_NOT_MERGE
REBASE_PR                     = #336 / CLOSED_NOT_MERGED_DURING_ATOMIC_REBASE
ORIGINAL_IMPLEMENTATION_PR    = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR   = #330 / SQUASH_MERGED
PREVIOUS_HANDOFF_PR           = #333 / SQUASH_MERGED
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PLANNED_OPERATION_COUNT       = 6
THIRD_ATTEMPT_META_OPERATIONS = 0
THIRD_ATTEMPT_REMOTE_WRITES   = 0
WORKER_FLAGS_AFTER_ATTEMPT    = ALL_FALSE_VERIFIED
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
NEXT_STEP                     = EXACT_HEAD_VERIFICATION_REVIEW_AND_MERGE
```

## Third Live failure retained

The one-time Terminal command on `main@e94ae9078cb4900f1876c933e11f7a2796913979`
passed local gates, generated-config preparation and Cloudflare safe-state readiness, then stopped at:

```text
stage   resume-pinned-meta-finalizer
code    META_HISTORY_2026_PINNED_FILES_MISSING
```

The finalizer required four historical local artifacts:

```text
MKT_META_FINALIZE_CLONE
MKT_META_FINALIZE_SESSION_FILE
MKT_META_FINALIZE_OVERLAY
MKT_META_FINALIZER_FILE
```

None was present in `.dev.vars` or a retained readiness manifest. The child failed before fresh Meta
identity validation and before the first of the six history operations. The outer wrapper verified the
Worker all-false state. No Meta Queue message, Provider request, Remote D1/Lark Business write, Worker
deployment, Schedule activation or Production action occurred.

## Root cause

The current history finalizer treated a historical local clone/session bundle as the authority for
preserving the old Meta delivery. That bundle was an execution artifact from a previous Head and is not a
durable Business-data contract. Requiring it made a new idempotent July backfill depend on local files that
may legitimately no longer exist.

The actual continuity requirements are:

- never replay or replace the historical operation;
- freshly validate the current Facebook source identity;
- use exactly one new deterministic Facebook July operation;
- complete that operation through existing Shared D1 and Lark phases;
- prove parity, same-operation idempotency and final all-false Reliability state.

## Corrections

- Remove `resolvePinnedMetaFiles()` and `resumePinnedFinalizer()` from the public history execution path.
- Do not require any `MKT_META_FINALIZE_*` environment variable or historical local clone/session file.
- Create a private `pinned-facebook-continuity.json` bound to the exact current Repository Head.
- Require a valid read-only Summary envelope with no mutation, exactly four validated identities and one
  valid Facebook identity request.
- Require the exact six-operation plan across every target, range, mode and deterministic operation ID.
- Require one deterministic Facebook July operation, no legacy operation ID,
  `existingOperationReplay=false`, `replacementOperation=false` and
  `legacyLocalArtifactsRequired=false`.
- Preserve the historical operation only as a non-secret fingerprint in continuity evidence.
- Continue through the existing Meta D1-only and Lark parity operators; no second Connector, Queue,
  Reliability, D1 writer or Lark sync engine is introduced.
- Read the canonical Meta Lark summary field `larkParityVerified`; reject the stale alias
  `larkVerified`.
- Preserve all prior Business facts and stable keys. No historical row is deleted or replaced.

## Main alignment

PR #342 is based directly on `main@9d79e45676600831e1cc2fd7ca358a3176c55295`. It retains concurrent
mainline corrections unchanged:

- Lark Dashboard scope and full-block recovery through `9d79e45676600831e1cc2fd7ca358a3176c55295`;
- Chatwoot Queue topology normalization at `b86d5fb36ad8f5e15c3e6d1b61507db4b0fe9694`.

PR #336 was automatically closed without merge when the Branch was temporarily moved to a Main commit
during the first atomic rebase. The prior Meta #102 `Diff hygiene` failure was caused by a shallow
`origin/main` fetch after Main advanced and did not represent a source formatting or test failure.

## Execution sequence after merge

```text
exact clean current main
→ local full gates
→ private safe config with absolute paths
→ Worker all-false and Reliability idle
→ fresh Facebook / Instagram / two Meta Ads identity validation
→ exact pinned Facebook continuity proof
→ Facebook July D1 then Lark parity/idempotency
→ Instagram July D1 then Lark parity/idempotency
→ Meta Ads May-July for both accounts
→ optional January-April Ads expansion under bounded volume
→ final all-false and zero active Work/Lock/Queue
→ META_HISTORY_2026_COMPLETED_SAFE
```

## Acceptance criteria

```text
Historical local Meta artifact dependency              0
Fresh Facebook identity validation                     required
Read-only Summary envelope                             passed / no mutation
Read-only identity validation count                    exactly 4
Current six-operation plan                             exact match
Legacy operation replay/replacement                    false / false
New Facebook July operation                            exactly 1
Legacy operation ID in current plan                    forbidden
Canonical Lark summary field                           larkParityVerified
Stale Lark alias                                       rejected
D1 before same-operation Lark continuation             required
D1/Lark parity and idempotent rerun                    required
Worker execution flags after every window              all false
Active Work / Lock / Queue at completion               0 / 0 / 0
Schedule / Production                                  disabled / blocked
Meta End-to-End Verification                           PASS required
Branch Verification                                    PASS required
Remote action during Repository implementation and CI  0
```

## Public command boundary

Do not rerun the Terminal command while PR #342 is unmerged. After exact-head verification, Review,
Squash Merge and a docs-only execution handoff, the only public entrypoint remains:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke the one-command child, finalizer child, D1/Lark phase launchers or manual Queue sends.
Retain all previous output/evidence directories.

Detailed contract: `docs/tasks/meta-history-pinned-continuity-recovery-v3.md`.
