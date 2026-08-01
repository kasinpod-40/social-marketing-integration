# Current Task — Chatwoot Safe Baseline Resume v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_SAFE_BASELINE_RESUME_V1
BRANCH                               = hotfix/chatwoot-safe-baseline-resume-v1
BASE_MAIN_SHA                        = f212c5110573ef0af5012e8385d6ee25e67041cd
CHATWOOT_LATEST_STOP                 = CHATWOOT_CONTROLLER_EVIDENCE_WORKER_FLAGS_INVALID
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE
CHATWOOT_INCOMPLETE_IDENTITIES       = 2
CHATWOOT_EXPECTED_BOUNDARY           = QUEUE_RETRY_EXHAUSTED_TERMINAL_V1
META_FACEBOOK_D1_PHASE               = COMPLETE
META_FACEBOOK_LARK_PHASE             = PENDING
META_PROVIDER_REPLAY_ALLOWED         = NO
META_D1_QUEUE_RESEND_ALLOWED         = NO
LATEST_REMOTE_MUTATIONS              = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_SAFE_BASELINE_RESUME
```

## Latest guarded stop

The exact pinned Chatwoot evidence-arbitration command stopped at:

```text
stage          read-current-chatwoot-worker
code           CHATWOOT_CONTROLLER_EVIDENCE_WORKER_FLAGS_INVALID
enabledFlags   []
```

This was a safe read-only stop before the child recovery launcher. It performed zero Provider request, Queue action,
Remote D1/Lark mutation, Worker deployment or incident closure. Schedule and Webhook remained disabled and Production
remained blocked.

The current Worker is already all-false rather than the retained four-flag Final UAT active window. The previous
arbitration selector therefore cannot bind the two incomplete evidence generations by retained active version.

## Root cause

The controller recovery chain supports the exact queue-retry-exhausted operation and can replace an interrupted active
deployment under Safe-restore ownership. However, the public evidence-arbitration wrapper assumed that the retained
active version must still be the current 100% Worker version.

When an earlier failure path has already returned the Worker to its proven all-false baseline, that assumption is no
longer true. Relaxing the active flag check alone would be unsafe because the inner Final UAT preflight still requires
the retained active version and because a new active window must only open after the exact D1 boundary is proven.

## Objective

Resume the one exact Chatwoot controller operation from the current all-false baseline without deleting or rewriting
retained evidence, choosing by recency, creating another Initial admission, weakening D1/Queue/Lark boundaries or
moving incident-closure authority out of the existing reviewed recovery launchers.

## New public authority

```text
scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs
```

The pinned wrapper creates a temporary bare `origin/main` fixed to the exact reviewed commit and delegates only to:

```text
scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
```

The inner wrapper must:

1. require the exact clean reviewed Head and existing recovery confirmation;
2. require exactly one current 100% Worker version with every execution flag false;
3. scan incomplete retained controller evidence without mutation;
4. select exactly one evidence identity whose retained baseline version equals the current safe Worker version;
5. verify the selected retained active version still exposes exactly the four approved Chatwoot Final UAT flags;
6. read the exact selected operation snapshot from Remote D1;
7. require `queue_retry_exhausted_terminal_v1`, replacement-deployment authority and zero active lock;
8. promote only the retained reviewed active version to 100%;
9. delegate to the existing evidence arbitration and recovery chain;
10. verify all flags false after completion and automatically restore the proven baseline only when the observed
    active version belongs to the selected/current-head recovery chain;
11. fail for review on any unknown concurrent deployment.

## Changed files

```text
scripts/lib/chatwoot-controller-safe-baseline-resume.js
scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs
tests/application/chatwoot-controller-safe-baseline-resume.test.js
docs/tasks/chatwoot-safe-baseline-resume-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-safe-baseline-resume.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Focused Meta, WooCommerce, Chatwoot and TikTok regressions remain required through Branch Verification. Repository
implementation and CI must perform zero Live or Remote mutation.

## Existing Chatwoot authority preservation

After the safe-baseline wrapper proves the current baseline and exact D1 boundary, it delegates to the unchanged:

```text
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
```

That authority still delegates exact selected evidence to:

```text
scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs
```

All Work reactivation, Queue continuation, Lark parity, replacement active deployment, ordinary Safe restore and
incident closure remain owned by those reviewed launchers.

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

The safe-baseline selector, guarded resume wrapper, exact pinned-origin entrypoint, focused tests and task documentation
are implemented on `hotfix/chatwoot-safe-baseline-resume-v1`. CI is pending. Repository implementation has performed
zero Live or Remote mutation.
