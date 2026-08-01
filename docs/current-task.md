# Current Task — Meta Retained Preflight-Anchored Evidence Recovery v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_RETAINED_PREFLIGHT_ANCHORED_RECOVERY_V1
BRANCH                               = hotfix/meta-retained-planless-chain-recovery-v1
BASE_MAIN_SHA                        = f629f2f94d6bccc8effac562c9cfe9eed2e7ec41
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_ORIGINAL_REQUESTED_AT       = 2026-07-31T16:51:11.017Z
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_WORK_LIFECYCLE              = ACTIVE
FACEBOOK_ACTIVE_LOCKS                = 0
FACEBOOK_QUEUE_OPERATION_ROWS        = 1
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
LATEST_CONTINUATION_STAGE            = materialize-retained-d1-summary
LATEST_CONTINUATION_CODE             = META_HISTORY_RETAINED_D1_EVIDENCE_FILES_MISSING
LATEST_MISSING_FILE                  = plan.json
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
PREVIOUS_HOTFIX_HEAD                 = 0f8af3bac0fc625c96fa20277dea52263c5e1a4e
BRANCH_VERIFICATION                  = run 30683056833 / #1562 / PASS
META_VERIFICATION                    = run 30683056836 / #146 / INFRA_FAILURE_BEFORE_TESTS
WORKER_FLAGS                         = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_PREFLIGHT_ANCHORED_RECOVERY
```

## Retained live boundary

The exact Facebook July operation remains D1-complete and Lark-pending:

```text
work_key      facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
work_type     facebook.page.organic.sync
operation_id  meta-facebook-history-20260701-20260731-1d12a5ec4fef
lifecycle     active
queue rows    1
active locks  0
```

Existing D1 facts and the existing Queue admission are authoritative. Do not restart, replace, abandon,
terminalize or resend this operation.

## Latest guarded stop

The public continuation stopped before Cloudflare context resolution or any Remote action because the retained
D1 summary recovery required `plan.json`, while the local evidence directory contains the executable chain from
`preflight.json` onward.

The emitted safety counters were all zero:

```text
Provider requests          0
Queue sends                0
Remote D1 mutations        0
Remote Lark mutations      0
Worker deployments         0
Schedule mutations         0
Production                 BLOCKED
```

## Root cause

The original D1-only operator explicitly allows `preflight` to begin without `plan.json`:

```text
readPriorEvidence(preflight)
  plan.json present  -> previousEvidenceSha256 = plan.evidenceSha256
  plan.json absent   -> previousEvidenceSha256 = null
```

PR #382 recovery incorrectly required every phase from `plan` through `verify-restore`. That requirement is
stricter than the retained operator contract and rejects a valid preflight-anchored chain.

The missing plan must not be synthesized. A preflight file that still references a non-null prior plan hash is
not accepted without the original plan evidence.

## Repository correction

The exact-plan public Terminal now supports two local-only evidence forms:

1. full chain: `plan` through `verify-restore`;
2. preflight-anchored chain: `preflight` through `verify-restore`, only when
   `preflight.previousEvidenceSha256 === null`.

For either form, recovery still requires:

- exact phase order with no missing executable phase;
- valid JSON, evidence SHA-256 and previous-evidence links;
- one target fingerprint across the chain;
- exact retained Repository Head, target, operation ID, original generation and period;
- exact Work key and Sync-run ID from the chain-start target payload;
- every phase status `passed`;
- final `verify-restore` in `safe` mode with zero expected true flags;
- summary validation through the existing Lark gate;
- clean current `main == origin/main`, exact reviewed Release path set and zero critical Meta drift;
- explicit continuation confirmation before any local file write.

If `plan.json` is absent but `preflight.previousEvidenceSha256` is non-null, recovery fails closed with:

```text
META_HISTORY_EXACT_CONTINUATION_D1_PLAN_ANCHOR_MISSING
```

No Provider, Queue, Remote D1/Lark, Worker deployment or Schedule capability is added to the materialization
path.

## Meta verification shallow-history correction

Meta End-to-End Verification #146 checked out the PR merge ref with `fetch-depth: 0`, then replaced the local
`origin/main` history with `git fetch origin main --depth=1`. The next command failed before any Source or test
step:

```text
fatal: origin/main...HEAD: no merge base
```

This was a workflow history-boundary failure, not a Source, test or Runtime failure. Branch Verification #1562
passed every repository gate on the same hotfix Head.

The Meta workflow now fetches the full main ref without a depth restriction, asserts that a merge base exists,
and only then runs `git diff --check`. A wiring regression rejects reintroduction of the shallow fetch. The
workflow file is included in the exact reviewed Release delta so the live continuation guard remains consistent
with the verified merge result.

## Current-main alignment

The hotfix is rebased onto `main@f629f2f94d6bccc8effac562c9cfe9eed2e7ec41`. The exact retained-Head delta now
includes the merged Lark Dashboard window-option-order and Chatwoot Final UAT baseline paths. No Meta-critical
Worker, Queue, D1 writer, Lark connector or finalizer path changed in those intervening merges.

## Changed files

```text
.github/workflows/meta-end-to-end-verification.yml
scripts/lib/meta-history-exact-plan-continuation.js
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
tests/application/meta-history-exact-plan-continuation.test.js
tests/application/meta-history-exact-plan-continuation-wiring.test.js
docs/current-task.md
```

## Verification required on exact branch Head

```text
npm ci
npm run check
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Repository implementation and CI must perform zero Remote actions. GitHub Meta End-to-End Verification and
Branch Verification are the release authority. The exact rebased Head must pass both before merge.

## Public command after verified merge

Only after the exact Hotfix Head passes all gates and is Squash Merged, run once from clean current `main`:

```bash
cd "/Users/wasanjantawong/Git/social-marketing-integration-woo-diag" && \
git fetch origin main && \
git switch main && \
git pull --ff-only origin main && \
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && \
test -z "$(git status --porcelain --untracked-files=all)" && \
CONFIRM_META_HISTORY_EXACT_CONTINUATION=CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY \
node scripts/meta-history-2026-exact-plan-continuation-terminal.mjs --execute
```

Do not run the ordinary Meta Terminal, D1/Lark child launchers or manual Queue commands. Do not edit retained
evidence, `.dev.vars`, lifecycle state or Business facts.

For the valid preflight-anchored form, the first accepted local marker must include:

```text
META_HISTORY_RETAINED_D1_SUMMARY_MATERIALIZED
evidenceChainStartPhase  preflight
planEvidencePresent      false
providerReplay           false
queueResend              false
remoteD1MutationCount    0
remoteLarkMutationCount  0
workerDeploymentCount    0
```

Live completion is not declared until the existing final marker is emitted:

```text
META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE
providerReplayForFacebook    false
d1QueueResendForFacebook     false
facebookLarkCompleted        true
finalDecision                META_HISTORY_2026_COMPLETED_SAFE
executionFlagsAllFalse       true
activeWork                   0
activeLocks                  0
activeQueueOperations        0
scheduleEnabled              false
production                   BLOCKED
```

## Implementation result

Repository changes are implemented on the rebased branch. Branch Verification #1562 passed
syntax/architecture/hygiene, focused Meta/Woo/Chatwoot/TikTok regressions, full Unit and Workers runtime tests,
Report reliability, dependency audit and Wrangler dry-run on the earlier hotfix Head. Meta Verification #146
stopped only at the shallow-history diff command before tests. The workflow correction, current-main exact delta
and regressions are now included; both workflows must pass on the exact rebased Head. Repository implementation
and CI performed zero Provider, Queue, Remote D1, Remote Lark, Worker deployment, Schedule or Production actions.
