# Current Task — Chatwoot Prior Selection Handoff v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_PRIOR_SELECTION_HANDOFF_V1
BRANCH                               = hotfix/chatwoot-prior-selection-handoff-v1
BASE_MAIN_SHA                        = 3d18effdf1865795ab183449102fc86e33fec287
CHATWOOT_LATEST_STOP                 = CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS
CHATWOOT_CANDIDATE_COUNT             = 2
CHATWOOT_BASELINE_VERSION_MATCHES    = 0
CHATWOOT_PRIOR_ATTEMPT_HEAD          = 87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c
CHATWOOT_PRIOR_ATTEMPT               = VALIDATED_BEFORE_INNER_SELECTOR
CHATWOOT_CURRENT_WORKER_FLAGS        = ALL_FALSE
LATEST_PROVIDER_QUEUE_D1_LARK_ACTION = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_PRIOR_SELECTION_HANDOFF
```

## Latest guarded stop

The prior-attempt public authority validated the exact retained attempt and current all-false Worker, then delegated to the existing safe-baseline chain. The inner selector stopped before Worker promotion with:

```text
stage                       select-chatwoot-safe-baseline-evidence
code                        CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS
candidateCount              2
baselineVersionMatchCount   0
```

The stop reported zero Provider, Queue, Remote D1, Remote Lark, incident-closure and Worker-deployment actions. Schedule and Webhook remained disabled and Production remained blocked.

## Root cause

The current all-false Worker version was proven by the prior attempt's `02-safe-restore.json`, but that version can be a replacement Safe version installed by an inner recovery operator. It is therefore not required to equal either original controller candidate's baseline Worker UUID.

The inner selector discarded the prior attempt's already-validated retained session, baseline-version and active-version fingerprints and still selected only by current Worker UUID equals candidate baseline UUID. The replacement Safe version matched neither candidate, producing zero baseline matches despite one exact prior candidate identity already being known.

## Objective

Carry the verified prior selection into the inner safe-baseline authority without trusting caller-supplied fingerprints. The inner authority must independently reload the prior attempt, bind exactly one retained candidate by the three fingerprints, preserve ordinary current-baseline selection for non-prior runs and keep all existing mutation and Safe-restore authorities unchanged.

## Contract

1. Ordinary safe-baseline selection remains unchanged and requires exactly one current baseline-version match.
2. Prior selection mode is enabled only when `MKT_CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_HEAD` is present.
3. The prior Head must be an exact strict ancestor of the current reviewed Head.
4. The inner safe-baseline authority independently calls `loadChatwootSafeBaselinePriorAttempt` against the retained directory and current Worker.
5. The prior directory, attempt, safe restore, current all-false flags and restored Worker fingerprint must pass the existing prior-attempt contract.
6. Candidate selection uses the exact retained session fingerprint plus direct SHA-256 baseline-version and active-version fingerprints.
7. Exactly one candidate fingerprint match is required; zero or multiple matches stop before promotion.
8. The new current-head attempt records `selectedBy=verified_prior_safe_baseline_attempt`, `priorAttemptHead` and `priorAttemptValidated=true`.
9. Downstream safe-baseline handoff validation accepts the new authority only with the exact prior fields and rejects prior fields on ordinary handoffs.
10. Existing retained active-version flag verification and Remote D1 queue-retry-exhausted boundary checks still occur before promotion.
11. Existing Worker promotion, pinned-origin arbitration, Initial recovery, Queue continuation, D1/Lark parity, incident closure and all-false Safe restore remain the only mutation authorities.
12. Retained evidence is not edited, deleted, renamed or overwritten.
13. A second Initial admission remains forbidden.
14. Schedule and Webhook remain disabled and Production remains blocked.

## Changed files

```text
scripts/lib/chatwoot-controller-safe-baseline-resume.js
scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
scripts/lib/chatwoot-controller-evidence-arbitration.js
tests/application/chatwoot-controller-safe-baseline-resume.test.js
tests/application/chatwoot-controller-evidence-arbitration.test.js
docs/tasks/chatwoot-prior-selection-handoff-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-safe-baseline-resume.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-safe-baseline-prior-attempt.test.js
node --test tests/application/chatwoot-initial-failure-worker-safety.test.js
node --test tests/application/chatwoot-controller-evidence-isolation.test.js
node --test tests/application/chatwoot-controller-safe-baseline-exact.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head. Repository implementation and CI perform zero Live or Remote mutation.

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

Meta must not resume until Chatwoot completes its exact recovery, verifies all execution flags false and closes the current Chatwoot incident safely.

## Implementation result

Prior-fingerprint selection, independent prior-attempt validation inside the safe-baseline authority, downstream handoff validation, focused regressions and task documentation are implemented on `hotfix/chatwoot-prior-selection-handoff-v1`. CI is pending. Repository implementation has performed zero Live or Remote mutation.
