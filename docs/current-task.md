# Current Task — Chatwoot Controller Evidence Arbitration v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = CHATWOOT_CONTROLLER_EVIDENCE_ARBITRATION_V1
BRANCH                               = hotfix/chatwoot-controller-evidence-arbitration-v1
BASE_MAIN_SHA                        = 6d71c19376b24c1baf64eb31aa191a24ad3d27fd
CHATWOOT_LATEST_STOP                 = CHATWOOT_INITIAL_FAILURE_SESSION_INVALID
CHATWOOT_INCOMPLETE_IDENTITIES       = 2
CHATWOOT_REMOTE_ACTIVE_WINDOW        = EXACT_FOUR_FLAG_FINAL_UAT
META_FACEBOOK_D1_PHASE               = COMPLETE
META_FACEBOOK_LARK_PHASE             = PENDING
META_PROVIDER_REPLAY_ALLOWED         = NO
META_D1_QUEUE_RESEND_ALLOWED         = NO
LATEST_REMOTE_MUTATIONS              = 0
SCHEDULE_WEBHOOK                     = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_EVIDENCE_ARBITRATION
```

## Latest guarded stop

The authorized Chatwoot recovery command stopped before D1 backup, Work reactivation, Queue send, Lark mutation,
Worker deployment or incident closure because two distinct incomplete local controller evidence identities were
visible:

```text
code            CHATWOOT_INITIAL_FAILURE_SESSION_INVALID
candidateCount  2
```

No Chatwoot controller process remained active. The Worker still exposed exactly the four reviewed Chatwoot Final
UAT execution flags, so Meta continuation correctly remained blocked to avoid cross-workstream deployment and Safe
restore collisions.

## Objective

Resolve the local evidence ambiguity without deleting, renaming or rewriting retained evidence and without weakening
the existing core recovery guard. The current active Worker deployment must be the sole arbitration authority.

## In scope

- Add a pure evidence-arbitration helper.
- Add an exact-head public wrapper that performs read-only Worker status/version inspection.
- Select one controller evidence identity only when its recorded active deployment equals the current active Worker
  version.
- Run the existing recovery launcher inside an isolated exact-main clone whose Final UAT evidence view contains only
  the proven candidate.
- Preserve current-head output evidence in the original workspace.
- Add focused regression coverage and an operator task document.

## Out of scope

- Editing or deleting retained controller evidence.
- Choosing a candidate by timestamp, directory name or newest Repository Head alone.
- Changing Chatwoot Business facts, stable keys, operation identity, requested-at or generation.
- Adding a second Initial admission, manual Queue send/redrive or direct Work mutation.
- Weakening the existing D1 boundary, active-version, baseline, parity, Safe restore or incident-closure checks.
- Running Meta continuation before Chatwoot restores all flags false.
- Schedule, Webhook or Production activation.

## Contract

The wrapper must:

1. require an exact reviewed wrapper Head and the existing Chatwoot recovery confirmation;
2. require a clean checkout whose commit remains an ancestor of current `origin/main`;
3. reject caller-provided `GIT_CONFIG_*` overrides;
4. read one current 100% Worker version and verify exactly the four Chatwoot Final UAT flags;
5. deduplicate exact local evidence copies but keep distinct baselines/deployments separate;
6. select exactly one identity bound to the current active Worker version;
7. fail closed for zero or multiple active-version matches;
8. expose no Worker version ID, Secret or customer data in failure output;
9. delegate all mutation and Safe restore behavior to
   `scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs`;
10. block blind rerun when current-head Final UAT evidence is already non-empty.

## Changed files

```text
scripts/lib/chatwoot-controller-evidence-arbitration.js
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
tests/application/chatwoot-controller-evidence-arbitration.test.js
docs/tasks/chatwoot-controller-evidence-arbitration-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Focused Meta, WooCommerce and TikTok regressions remain required through Branch Verification. Repository gates must
perform zero Provider mutation, Queue action, Remote D1/Lark mutation, Worker deployment, incident closure,
Schedule/Webhook action or Production action.

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

The arbitration helper, isolated wrapper, focused tests and task documentation are implemented on
`hotfix/chatwoot-controller-evidence-arbitration-v1`. CI is pending. Repository implementation has performed no Live
or Remote mutation.
