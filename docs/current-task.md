# Current Task — Chatwoot Selected Evidence Handoff v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_SELECTED_EVIDENCE_HANDOFF_V1
BRANCH                               = hotfix/chatwoot-selected-evidence-handoff-v1
BASE_MAIN_SHA                        = 3a86babaea761528856d70af0dafc250c7216dd0
CHATWOOT_LATEST_STOP                 = CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE_AFTER_VERIFIED_SAFE_RESTORE
CHATWOOT_INCOMPLETE_IDENTITIES       = 2
CHATWOOT_ACTIVE_VERSION_MATCHES      = 2
CHATWOOT_SELECTED_PARENT_IDENTITY    = ALREADY_PROVEN_BY_SAFE_BASELINE
META_FACEBOOK_D1_PHASE               = COMPLETE
META_FACEBOOK_LARK_PHASE             = PENDING
META_PROVIDER_REPLAY_ALLOWED         = NO
META_D1_QUEUE_RESEND_ALLOWED         = NO
LATEST_PROVIDER_QUEUE_D1_LARK_ACTION = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_SELECTED_EVIDENCE_HANDOFF
```

## Latest guarded stop

The reviewed safe-baseline operator selected one retained controller identity by its exact all-false baseline, proved
the retained active version and exact Remote D1 `queue_retry_exhausted_terminal_v1` boundary, promoted that retained
active version, and then delegated to the existing evidence-arbitration wrapper.

The child stopped before its recovery launcher with:

```text
stage                    select-chatwoot-controller-evidence
code                     CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS
candidateCount           2
activeVersionMatchCount  2
```

The safe-baseline wrapper then verified all execution flags false. Provider, Queue, Remote D1, Remote Lark and incident
closure actions remained zero. The only transient action was the recovery-owned Worker version promotion followed by
verified all-false Safe restore.

## Root cause

The parent safe-baseline wrapper had already selected the correct evidence identity by exact baseline version and wrote
`outputs/chatwoot-controller-safe-baseline-resume/<reviewed-head>/01-active-window.attempt.json` before promotion.

The existing child arbitration wrapper did not consume that parent selection. It rescanned every incomplete retained
controller generation and selected only by the now-current retained active Worker version. Both historical evidence
identities reference the same retained active version, so the child correctly failed closed with two matches.

## Objective

Carry the exact non-mutating safe-baseline selection handoff into the existing arbitration authority so the child does
not discard the parent decision or choose by recency. Preserve active Worker verification, retained evidence
immutability, isolated exact-main execution, the existing recovery launcher, no second Initial admission and automatic
all-false Safe restore.

## Contract

The existing safe-baseline parent already writes the handoff before any Worker promotion. The arbitration wrapper must:

1. look only for the exact current-head private regular file
   `outputs/chatwoot-controller-safe-baseline-resume/<head>/01-active-window.attempt.json`;
2. treat absence as the original active-version-only arbitration path;
3. when present, require the exact `chatwoot_controller_safe_baseline_resume_v1` contract, current repository Head,
   `queue_retry_exhausted_terminal_v1`, `current_safe_baseline_version`, zero parent Queue/D1/Lark actions, no second
   Initial admission, Schedule/Webhook false and Production false;
4. validate the retained session, baseline-version and active-version SHA-256 fingerprints;
5. continue requiring the current Worker to expose the exact four Chatwoot Final UAT flags;
6. select exactly one candidate matching both the current active Worker version and every verified handoff fingerprint;
7. fail closed when the handoff matches zero or multiple identities;
8. preserve the existing isolated evidence view and delegate unchanged to
   `scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs`;
9. never mutate, rename or delete retained evidence and never send Queue/D1/Lark actions itself.

## Changed files

```text
scripts/lib/chatwoot-controller-evidence-arbitration.js
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
tests/application/chatwoot-controller-evidence-arbitration.test.js
docs/tasks/chatwoot-selected-evidence-handoff-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
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

Meta remains blocked until the exact Chatwoot recovery completes, incident closure passes and every execution flag is
verified false.

## Implementation result

The verified parent-handoff validator, fingerprint-bound selector, child arbitration integration, focused regressions
and task documentation are implemented on `hotfix/chatwoot-selected-evidence-handoff-v1`. CI is pending. Repository
implementation has performed zero Live or Remote mutation.
