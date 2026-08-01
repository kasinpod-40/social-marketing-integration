# Chatwoot Safe Baseline Resume v1

## Status

```text
TASK_STATUS              = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BRANCH                    = hotfix/chatwoot-safe-baseline-resume-v1
BASE_MAIN                 = f212c5110573ef0af5012e8385d6ee25e67041cd
LATEST_GUARDED_STOP       = CHATWOOT_CONTROLLER_EVIDENCE_WORKER_FLAGS_INVALID
CURRENT_WORKER_FLAGS      = ALL_FALSE
BLIND_RERUN               = BLOCKED_BY_CURRENT_HEAD_EVIDENCE
LIVE_ACTIONS_THIS_HOTFIX  = 0
SCHEDULE_WEBHOOK          = disabled
PRODUCTION                = blocked
```

## Incident

The exact pinned Chatwoot evidence-arbitration command stopped at the read-only Worker gate because the current
Worker exposed zero enabled execution flags. No Provider request, Queue action, Remote D1/Lark mutation, Worker
deployment or incident closure occurred.

The previous arbitration authority assumed that an incomplete controller session must still own its retained active
Worker version. The observed Worker had already returned to an all-false safe version, so the active-version selector
could not safely choose between the two retained incomplete evidence generations.

## Objective

Resume the one exact queue-retry-exhausted Chatwoot controller operation from an already-restored safe baseline
without deleting or rewriting retained evidence, creating another Initial admission, weakening the D1 boundary, or
moving mutation authority out of the existing reviewed recovery chain.

## Contract

The only public entrypoint is:

```text
scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs
```

Before any child starts, it requires the exact clean reviewed Head and checks:

```text
outputs/chatwoot-controller-safe-baseline-resume/<reviewed-head>
```

The directory must be absent or empty. Any attempt, Safe-restore, temporary or summary evidence blocks blind rerun
before Worker inspection, Queue, D1, Lark, deployment or incident-closure action.

The exact terminal delegates to:

```text
scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs
```

It pins every nested `origin/main` fetch to the exact reviewed wrapper commit and delegates to:

```text
scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
```

The inner safe-baseline wrapper must:

1. require an exact clean reviewed checkout and the existing Chatwoot recovery confirmation;
2. read the current Worker and require exactly one 100% version with every execution flag false;
3. scan retained incomplete controller evidence without editing, renaming or deleting it;
4. deduplicate exact evidence copies and select exactly one identity whose retained baseline version equals the
   current all-false Worker version;
5. verify the selected retained active version still contains exactly the four reviewed Chatwoot Final UAT flags;
6. read the exact operation snapshot from Remote D1 without mutation;
7. require the reviewed `queue_retry_exhausted_terminal_v1` boundary, replacement-deployment authority and zero
   active lock;
8. write current-head attempt evidence before any retained-active promotion;
9. promote the retained reviewed active version to 100% using Wrangler Versions only after all read-only gates pass;
10. delegate evidence arbitration, Work reactivation, Queue continuation, Lark parity, active replacement, final
    incident closure and ordinary Safe restore to the existing reviewed launchers;
11. verify every execution flag false on completion;
12. restore the proven baseline version automatically when the current Worker remains in one known exact Chatwoot
    active version after an interrupted child;
13. fail for manual review rather than overwrite an unknown concurrent Worker version.

## Safety boundaries

- The selector never chooses by timestamp, directory name or newest Repository Head alone.
- A baseline match must be unique after exact evidence deduplication.
- The retained baseline and retained active versions must be different.
- The wrapper never calls the Queue messages endpoint.
- The wrapper contains no D1 mutation SQL and performs no Lark write.
- The wrapper never sends a second Initial admission.
- Schedule and Webhook remain false; Production remains blocked.
- A failure before retained-active promotion has zero remote mutation.
- Attempt evidence is atomic and precedes promotion, so an interrupted mutation path cannot be blindly rerun.
- After promotion, the wrapper owns all-false verification and only restores when the active version belongs to the
  proven retained/current-head recovery chain.

## Changed files

```text
scripts/lib/chatwoot-controller-safe-baseline-resume.js
scripts/lib/chatwoot-safe-baseline-current-head-guard.js
scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs
scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs
tests/application/chatwoot-controller-safe-baseline-resume.test.js
tests/application/chatwoot-controller-safe-baseline-exact.test.js
docs/tasks/chatwoot-safe-baseline-resume-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-safe-baseline-exact.test.js
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

Branch Verification must also pass the focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head.
Repository implementation and CI must perform zero Live or Remote mutation.
