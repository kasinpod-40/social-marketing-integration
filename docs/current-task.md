# Current Task — Chatwoot Arbitration Pinned Origin v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_ARBITRATION_PINNED_ORIGIN_V1
BRANCH                               = hotfix/chatwoot-arbitration-pinned-origin-v1
BASE_MAIN_SHA                        = ee5c6ce2450ee052669edc24e7af75e1b47cfc4f
CHATWOOT_INCOMPLETE_IDENTITIES       = 2
CHATWOOT_REMOTE_ACTIVE_WINDOW        = EXACT_FOUR_FLAG_FINAL_UAT
CHATWOOT_CONTROLLER_PROCESS          = ABSENT
META_FACEBOOK_D1_PHASE               = COMPLETE
META_FACEBOOK_LARK_PHASE             = PENDING
META_PROVIDER_REPLAY_ALLOWED         = NO
META_D1_QUEUE_RESEND_ALLOWED         = NO
LATEST_REMOTE_MUTATIONS              = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_PINNED_ORIGIN
```

## Pre-handoff finding

PR #411 added current-active-Worker evidence arbitration and passed Branch Verification #1596. Before issuing its
operator command, final execution-path review found that the isolated arbitration clone still used the source local
workspace as its Git `origin`.

The delegated recovery launcher runs:

```text
git fetch origin main
```

If the operator checks out the reviewed wrapper in detached mode while the source local `main` branch remains on an
older commit, that fetch can replace the clone's pinned `origin/main` with the stale local branch. The recovery would
then stop at its exact-main gate even though the reviewed wrapper itself is valid.

No operator command using PR #411's wrapper was issued. This finding caused zero Provider request, Queue action,
Remote D1/Lark mutation, Worker deployment, incident closure, Schedule/Webhook action or Production action.

## Objective

Keep every nested Chatwoot recovery `git fetch origin main` bound to the exact reviewed wrapper commit without
modifying the existing arbitration wrapper, core recovery launcher, retained evidence or Business facts.

## Correction

Add a small outer authority:

```text
scripts/chatwoot-controller-evidence-pinned-origin-terminal.mjs
```

It must:

1. require the exact reviewed outer-wrapper commit and existing Chatwoot recovery confirmation;
2. require a clean checkout whose commit remains an ancestor of current public `origin/main`;
3. reject caller-provided `GIT_CONFIG_*` overrides;
4. create a temporary bare repository whose `refs/heads/main` and symbolic `HEAD` equal the exact reviewed commit;
5. create an exact `main` worktree from that temporary origin;
6. copy `.dev.vars` and `wrangler.sync.jsonc` as private regular files;
7. link local `outputs` and `node_modules` under exact clone-local excludes;
8. perform a real `git fetch origin main` and reverify exact `HEAD`, `origin/main`, branch and cleanliness;
9. invoke the existing
   `scripts/chatwoot-controller-evidence-arbitration-terminal.mjs` inside the pinned repository;
10. leave all evidence selection, D1 boundary, Queue, Lark, parity, Safe restore and incident closure authority with
    the existing reviewed inner launchers.

## Fail-closed boundaries

- No remote Worker, Queue, D1 or Lark action occurs before the existing inner arbitration wrapper starts.
- No retained evidence is renamed, deleted or rewritten by the outer wrapper.
- The outer wrapper does not inspect or choose between controller evidence candidates itself.
- A stale or advanced source local `main` cannot alter the nested synthetic `origin/main`.
- Any existing inner failure remains visible and must not be blindly rerun after mutation begins.
- Schedule and Webhook remain disabled; Production remains blocked.

## Real-Git regression

The regression creates a source repository with reviewed commit A and later commit B. It leaves source `main` on B,
creates the synthetic origin pinned to A, runs `git fetch origin main` in the generated clone and requires:

```text
clone HEAD             = A
clone origin/main      = A
bare refs/heads/main   = A
source main            = B
```

## Changed files

```text
scripts/lib/exact-pinned-git-origin.js
scripts/chatwoot-controller-evidence-pinned-origin-terminal.mjs
tests/application/chatwoot-controller-evidence-pinned-origin.test.js
docs/tasks/chatwoot-arbitration-pinned-origin-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-evidence-pinned-origin.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Focused Meta, WooCommerce, Chatwoot and TikTok regressions remain required through Branch Verification. Repository
gates must perform zero Live or Remote mutation.

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

Meta must not resume until Chatwoot completes Safe restore and the Worker is verified all-false.

## Implementation result

The pinned Git-origin helper, outer wrapper, real-Git regression and task documentation are implemented on
`hotfix/chatwoot-arbitration-pinned-origin-v1`. CI is pending. Repository implementation has performed no Live or
Remote mutation.
