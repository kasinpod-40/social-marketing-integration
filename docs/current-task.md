# Current Task — Chatwoot Safe-Baseline Prior Attempt v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_V1
BRANCH                               = hotfix/chatwoot-safe-baseline-prior-attempt-v1
BASE_MAIN_SHA                        = 87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c
CHATWOOT_LATEST_STOP                 = CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_PRESENT
CHATWOOT_PRIOR_ATTEMPT_HEAD          = 87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c
CHATWOOT_PRIOR_EVIDENCE_ENTRIES      = 2
CHATWOOT_PRIOR_SAFE_RESTORE          = PRESENT_AND_REQUIRES_EXACT_VALIDATION
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE_REPORTED_BY_PRIOR_PARENT
LATEST_PROVIDER_QUEUE_D1_LARK_ACTION = 0_FOR_LATEST_GUARD_STOP
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_PRIOR_ATTEMPT_AUTHORITY
```

## Latest guarded stop

The public exact terminal refused another invocation on repository Head
`87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c` because the current-head safe-baseline directory already contains two
entries:

```text
stage       verify-chatwoot-safe-baseline-current-head
code        CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_PRESENT
entryCount  2
```

This stop occurred before child start and reported zero Provider, Queue, Remote D1, Remote Lark, Worker deployment and
incident-closure actions. It must not be bypassed by deleting, renaming or editing evidence.

## Root cause and required route

The previous reviewed run created its active-window attempt evidence and all-false safe-restore evidence. The blind-rerun
guard has no authority to determine whether those two files form one exact resumable chain, so it correctly blocks.

A new reviewed outer authority must validate the prior attempt and current Worker state before delegating to the existing
exact terminal on a new reviewed Head. The existing exact terminal will then perform fresh retained-evidence, Worker and
Remote D1 boundary checks before any promotion or mutation.

## Objective

Validate and bind the exact prior safe-baseline attempt without mutating it. Continue only when the prior directory has
the exact two-file incomplete shape, the handoff and restore contracts agree, the current Worker remains all-false and
its version fingerprint matches the prior safe restore. Preserve every existing recovery guard and mutation authority.

## Contract

1. The prior attempt Head is explicitly supplied and must be a strict ancestor of the reviewed wrapper Head.
2. The prior directory must be a real directory containing exactly:
   - `01-active-window.attempt.json`
   - `02-safe-restore.json`
3. `03-summary.json`, any additional entry, missing entry or symlink blocks continuation.
4. Both evidence files must be private regular files.
5. The attempt must pass the existing `validateChatwootSafeBaselineSelectionHint` contract for the prior Head.
6. The safe restore must use the same contract version, repository Head and retained session fingerprint.
7. `restoredAllFlagsFalse` must be true; Schedule/Webhook and Production must be false.
8. The current Worker must have exactly one active version and zero enabled execution flags.
9. The current active version's direct SHA-256 fingerprint must match the prior safe-restore fingerprint.
10. The current reviewed Head must pass the existing empty-evidence guard before child start.
11. The outer authority performs read-only Git, local evidence and Worker inspection only.
12. It may not call Queue, D1 mutation, Lark, Worker deployment or incident closure directly.
13. The child remains `scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs`.
14. The existing safe-baseline, pinned-origin, arbitration, Initial recovery, Final UAT and all-false Safe-restore chain
    remains unchanged.
15. A second Initial admission remains forbidden; Schedule/Webhook remain disabled and Production remains blocked.

## Changed files

```text
scripts/lib/chatwoot-safe-baseline-prior-attempt.js
scripts/chatwoot-safe-baseline-prior-attempt-terminal.mjs
tests/application/chatwoot-safe-baseline-prior-attempt.test.js
docs/tasks/chatwoot-safe-baseline-prior-attempt-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-safe-baseline-prior-attempt.test.js
node --test tests/application/chatwoot-initial-failure-worker-safety.test.js
node --test tests/application/chatwoot-controller-evidence-isolation.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-controller-safe-baseline-resume.test.js
node --test tests/application/chatwoot-controller-safe-baseline-exact.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head. Repository
implementation and CI perform zero Live or Remote mutation.

## Meta continuation boundary

The retained Meta operation remains unchanged:

```text
operation ID       meta-facebook-history-20260701-20260731-1d12a5ec4fef
retained Head      5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
D1 phase           complete
Lark phase         pending
provider replay    forbidden
D1 Queue resend    forbidden
```

The preserved public Meta continuation authority remains:

```text
scripts/meta-history-2026-reviewed-release-terminal.mjs
```

Inside the immutable reviewed release clone, it delegates only to:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

Meta must not resume until Chatwoot completes its exact recovery, verifies all execution flags false and closes the
current Chatwoot incident safely.

## Implementation result

The prior-attempt validator, read-only public terminal, real-filesystem regression and task documentation are implemented
on `hotfix/chatwoot-safe-baseline-prior-attempt-v1`. CI is pending. Repository implementation has performed zero Live or
Remote mutation.
