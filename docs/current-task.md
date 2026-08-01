# Current Task — Chatwoot Isolated Evidence Real Directory v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_ISOLATED_EVIDENCE_REAL_DIRECTORY_V1
BRANCH                               = hotfix/chatwoot-isolated-evidence-real-directory-v1
BASE_MAIN_SHA                        = 07599a10326d3976fb8344fe3e4b90bdc9426aaf
CHATWOOT_LATEST_STOP                 = CHATWOOT_INITIAL_FAILURE_SESSION_MISSING
CHATWOOT_SELECTED_PARENT_IDENTITY    = PROVEN_AND_HANDOFF_BOUND
CHATWOOT_ISOLATED_CANDIDATE          = SYMLINK_NOT_DIRENT_DIRECTORY
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE_AFTER_VERIFIED_SAFE_RESTORE
LATEST_PROVIDER_QUEUE_D1_LARK_ACTION = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_REAL_DIRECTORY_ISOLATION
```

## Latest guarded stop

The safe-baseline parent selected the exact retained controller identity, proved the retained active version and Remote
D1 `queue_retry_exhausted_terminal_v1` boundary, and passed the selection fingerprints into the arbitration child.

The Initial recovery launcher then stopped with:

```text
code     CHATWOOT_INITIAL_FAILURE_SESSION_MISSING
message  No retained candidate can be inspected
```

The child performed zero Provider request, Queue action, Remote D1/Lark mutation, Worker deployment or incident closure.
The safe-baseline parent verified every execution flag false afterward. Schedule and Webhook remained disabled and
Production remained blocked.

## Root cause

The arbitration wrapper created the selected evidence entry inside its isolated clone with:

```text
symlink(selectedEvidenceDirectory, isolatedFinalUatRoot/<selected-head>)
```

The Initial recovery launcher enumerates that root with `readdir(..., { withFileTypes: true })` and admits only
`entry.isDirectory()`. A directory symlink returns `isSymbolicLink()`, not `isDirectory()`, so the exact selected
candidate was discarded before session JSON or D1 inspection.

## Objective

Keep the already-proven selection and isolated exact-main execution, but expose the selected evidence to the unchanged
Initial recovery launcher as a real temporary directory. Do not edit, rename or delete retained evidence and do not move
Queue, D1, Lark, Worker promotion, Safe restore or incident-closure authority.

## Contract

1. The selected source evidence must be a real directory rather than a symlink.
2. The isolated destination must be absent before materialization.
3. The wrapper copies the selected evidence into the temporary clone with dereferenced regular files.
4. The resulting selected entry must pass `Dirent.isDirectory()`.
5. `session.json`, `read-only-preflight.json`, `active-deployment.json` and `initial-send.attempt.json` must be regular,
   non-symlink files in the isolated directory.
6. The source retained evidence remains byte-preserved and unchanged.
7. The current-head output path continues to point to the authoritative workspace for recovery output.
8. The existing `scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs` remains the only recovery child.
9. No second Initial admission is permitted.
10. Schedule and Webhook remain disabled; Production remains blocked.

## Changed files

```text
scripts/lib/chatwoot-controller-evidence-isolation.js
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
tests/application/chatwoot-controller-evidence-isolation.test.js
docs/tasks/chatwoot-isolated-evidence-real-directory-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
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

Meta must not resume until Chatwoot completes its exact recovery, verifies all execution flags false, and closes the
current Chatwoot incident safely.

## Implementation result

The real-directory materializer, arbitration integration, real-filesystem regression and task documentation are
implemented on `hotfix/chatwoot-isolated-evidence-real-directory-v1`. CI is pending. Repository implementation has
performed zero Live or Remote mutation.
