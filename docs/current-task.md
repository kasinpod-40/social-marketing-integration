# Current Task — Chatwoot Inspector Active Resume Window v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_INSPECTOR_ACTIVE_RESUME_WINDOW_V1
BRANCH                               = hotfix/chatwoot-inspector-active-resume-window-v1
BASE_MAIN_SHA                        = 0c6ddf535af10c6f031bb9a9beb553858bcbbe69
CHATWOOT_LATEST_STOP                 = CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE
CHATWOOT_SELECTED_PARENT_IDENTITY    = PROVEN_AND_HANDOFF_BOUND
CHATWOOT_ISOLATED_CANDIDATE          = REAL_DIRECTORY_AND_CHILD_VISIBLE
CHATWOOT_OBSERVED_TRUE_FLAGS         = EXACT_FINAL_UAT_FOUR_FLAG_WINDOW
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE_AFTER_VERIFIED_SAFE_RESTORE
LATEST_PROVIDER_QUEUE_D1_LARK_ACTION = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_INSPECTOR_ACTIVE_RESUME_WINDOW
```

## Latest guarded stop

The safe-baseline parent selected the exact retained controller identity, proved the retained active version and
Remote D1 `queue_retry_exhausted_terminal_v1` boundary, promoted the retained active Worker and delegated through the
arbitration wrapper. The selected evidence was visible to the Initial recovery child as a real directory.

The Initial failure inspector then stopped before backup, Work reactivation, Queue continuation, D1/Lark mutation or
incident closure with:

```text
code       CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE
trueFlags  MKT_CONNECTOR_CHATWOOT_ENABLED
           MKT_CHATWOOT_D1_WRITE_ENABLED
           MKT_CHATWOOT_LARK_WRITE_ENABLED
           MKT_CHATWOOT_REPORT_WRITE_ENABLED
```

The safe-baseline parent verified every execution flag false after the child failure. Provider, Queue, Remote D1,
Remote Lark and incident-closure actions remained zero. Schedule and Webhook remained disabled and Production remained
blocked.

## Root cause

`chatwoot-initial-terminal-failure-inspector.mjs` supported only an all-false Worker state. That is correct for
ordinary standalone inspection, but the exact safe-baseline controller-resume path intentionally promotes the retained
four-flag Final UAT active version before invoking the inspector. The inspector therefore rejected the exact active
window already selected, version-bound and Safe-restore-owned by its parent.

## Objective

Preserve ordinary all-false inspection while admitting the exact controller-resume active window only when it is bound
to the current-head safe-baseline handoff and current Worker version fingerprint. Do not change the recovery launcher,
Queue/D1/Lark mutation authority, incident closure, retained evidence, second-Initial prohibition or Safe restore.

## Contract

1. Ordinary inspector execution still accepts only zero true execution flags.
2. An active inspector window is accepted only when the true flags equal the four exported Chatwoot Final UAT flags
   exactly.
3. No Schedule, Webhook or other `MKT_*_ENABLED` flag may be true.
4. The current-head file
   `outputs/chatwoot-controller-safe-baseline-resume/<head>/01-active-window.attempt.json` must exist as a private,
   regular, non-symlink file.
5. The attempt must pass `validateChatwootSafeBaselineSelectionHint` for the current repository Head.
6. The current active Worker version must match the attempt's direct SHA-256 retained-active-version fingerprint.
7. Missing/malformed handoff, duplicate flags, version drift and any additional true flag remain fail closed with
   `CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE`.
8. The inspector remains SELECT-only and performs no Provider, Queue, D1/Lark mutation, deployment or incident closure.
9. The existing recovery launcher remains unchanged and no second Initial admission is allowed.
10. Existing parent/inner operators retain all-false Safe restore ownership; Schedule/Webhook stay disabled and
    Production stays blocked.

## Changed files

```text
scripts/lib/chatwoot-initial-failure-worker-safety.js
scripts/chatwoot-initial-terminal-failure-inspector.mjs
tests/application/chatwoot-initial-failure-worker-safety.test.js
docs/tasks/chatwoot-inspector-active-resume-window-v1.md
docs/project-brain/chatwoot-initial-terminal-failure-recovery-2026-08-01.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-initial-failure-worker-safety.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-controller-evidence-isolation.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-controller-safe-baseline-resume.test.js
node --test tests/application/chatwoot-controller-safe-baseline-exact.test.js
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

Meta must not resume until Chatwoot completes its exact recovery, verifies all execution flags false, and closes the
current Chatwoot incident safely.

## Implementation result

The exact worker-safety classifier, current-head handoff validation, inspector integration, focused regressions and
project documentation are implemented on `hotfix/chatwoot-inspector-active-resume-window-v1`. CI is pending.
Repository implementation has performed zero Live or Remote mutation.
