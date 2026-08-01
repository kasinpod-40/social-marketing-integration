# Current Task — Chatwoot Final UAT Closeout and Meta Handoff

## Status

```text
TASK_STATUS                          = DOCUMENTATION_CLOSEOUT_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_FINAL_UAT_CLOSEOUT_META_HANDOFF_V1
BRANCH                               = docs/chatwoot-final-uat-closeout-2026-08-01
BASE_MAIN_SHA                        = f212c5110573ef0af5012e8385d6ee25e67041cd
CHATWOOT_FINAL_UAT                   = COMPLETED_SAFE
CHATWOOT_COMPLETION_MARKER           = CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
CHATWOOT_EXACT_LOCK_SCOPE_VERIFIED   = TRUE
CHATWOOT_ACTIVE_LOCK_COUNT           = 0
CHATWOOT_SAFE_RESTORE_VERIFIED       = TRUE
CHATWOOT_SCHEDULE_WEBHOOK            = DISABLED
META_FACEBOOK_D1_PHASE               = COMPLETE
META_FACEBOOK_LARK_PHASE             = PENDING
META_PROVIDER_REPLAY_ALLOWED         = NO
META_D1_QUEUE_RESEND_ALLOWED         = NO
PRODUCTION                           = BLOCKED
NEXT_STEP                            = REVIEW_AND_MERGE_CLOSEOUT_THEN_RUN_META_REVIEWED_RELEASE_CONTINUATION
```

## Accepted Chatwoot completion evidence

The user supplied the successful Terminal result from the guarded Chatwoot controller-evidence recovery path after
PR #412 was Squash Merged into `main@f212c5110573ef0af5012e8385d6ee25e67041cd`.

The accepted completion output reports:

```text
contractVersion         chatwoot-initial-terminal-failure-recovery-v1
status                  completed_safe
marker                  CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
exactLockScopeVerified  true
activeLockCount         0
safeRestoreVerified     true
```

The output also shows completion of the retained Initial/Daily controller sequence and restoration of the Worker to
the reviewed all-false state. Schedule and Webhook remain disabled. Production remains blocked.

This documentation closeout does not independently rerun Remote D1/Lark/Worker inspection. It records the accepted
operator result supplied by the user and performs no Live or Remote action.

## Chatwoot closeout decision

Chatwoot is no longer an active blocker for the Integration Workspace sequence.

Do not run any previous Chatwoot recovery, Queue-exhaustion recovery, evidence-arbitration or pinned-origin command
again. Do not send a second Initial/Daily admission, manually redrive a Chatwoot DLQ or edit retained Chatwoot
evidence. Any later Chatwoot work must start as a new explicitly scoped task from the completed-safe baseline.

## Restored Meta continuation authority

The retained Meta operation remains unchanged:

```text
operation ID       meta-facebook-history-20260701-20260731-1d12a5ec4fef
retained Head      5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
D1 phase           complete
Lark phase         pending
provider replay    forbidden
D1 Queue resend    forbidden
```

The only preserved public continuation authority is:

```text
scripts/meta-history-2026-reviewed-release-terminal.mjs
```

Inside the immutable reviewed release clone it may delegate only to:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

The continuation must reuse the retained Facebook operation and existing D1 completion. It must not replay the Meta
Provider, resend the original D1 Queue admission, synthesize evidence, modify Business facts, enable Schedule or
perform Production work.

Live Meta execution remains a separate explicit operational action. This documentation branch does not run it.

## Parallel Report boundary

Repository-only Report audits and implementations may continue on isolated branches without editing this Current
Task or touching retained Meta/Chatwoot evidence. Remote Report materialization, Lark writes, Queue sends, Worker
deployment and Schedule activation remain separately gated.

The next Report sequence remains:

1. WooCommerce Report Live Readiness Audit v1 — read-only first;
2. YouTube Report readiness/materialization planning from the proven 837-row source baseline;
3. Instagram and Google Ads source-promotion blocker audit;
4. Chatwoot generic Report contract implementation from the completed-safe source baseline.

## Changed files

```text
docs/current-task.md
docs/tasks/chatwoot-final-uat-closeout-2026-08-01.md
docs/project-brain/chatwoot-final-uat-closeout-2026-08-01.md
```

## Required verification

Documentation-only verification must confirm:

```bash
git diff --check
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Repository verification must perform zero Provider request, Queue/DLQ action, Remote D1/Lark action, Worker
deployment, Secret/config mutation, Schedule/Webhook action or Production action.

## Implementation result

The Chatwoot completed-safe operator result is recorded, prior recovery commands are retired and the Meta reviewed
release continuation is restored as the next operational gate. This branch performs documentation changes only and
has executed no Live or Remote action.
