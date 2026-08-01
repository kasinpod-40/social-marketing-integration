# Chatwoot Safe-Baseline Prior Attempt v1

## Incident

A reviewed Chatwoot safe-baseline run on repository Head
`87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c` created two current-head files and later restored the Worker all-false.
The public exact terminal correctly blocked another invocation with
`CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_PRESENT` and `entryCount=2`.

The two files are expected to be:

```text
01-active-window.attempt.json
02-safe-restore.json
```

They must not be deleted, renamed, edited or bypassed by pretending the attempt never happened.

## Objective

Continue only through a new reviewed authority that validates the exact prior attempt and safe restore before delegating
to the unchanged current exact recovery terminal. The current exact recovery still performs fresh Worker, retained
evidence and Remote D1 boundary checks before any promotion or mutation.

## Contract

1. The prior attempt Head is explicitly pinned and must be a strict ancestor of the reviewed wrapper Head.
2. Its safe-baseline evidence directory must be real and contain exactly the two files above.
3. Both files must be private regular non-symlink files.
4. The active-window attempt must pass the existing safe-baseline handoff validator.
5. The safe-restore evidence must use the same contract, repository Head and retained session fingerprint.
6. `restoredAllFlagsFalse` must be true; Schedule/Webhook and Production must be false.
7. The current Worker must have zero true execution flags.
8. The current Worker version's direct SHA-256 fingerprint must equal the retained safe-restore fingerprint.
9. Any summary, extra file, missing file, symlink, version drift or flag drift fails before the child starts.
10. The wrapper performs no Provider request, Queue action, Remote D1/Lark mutation, deployment or incident closure.
11. The current reviewed Head must still have no evidence before delegation.
12. The child remains `scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs` and no second Initial admission is
    permitted.

## Files

```text
scripts/lib/chatwoot-safe-baseline-prior-attempt.js
scripts/chatwoot-safe-baseline-prior-attempt-terminal.mjs
tests/application/chatwoot-safe-baseline-prior-attempt.test.js
docs/tasks/chatwoot-safe-baseline-prior-attempt-v1.md
docs/current-task.md
```

## Verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-safe-baseline-prior-attempt.test.js
node --test tests/application/chatwoot-initial-failure-worker-safety.test.js
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

Repository implementation and CI perform zero Live or Remote mutation. Live execution remains blocked until the exact
Head passes Branch Verification and is merged.
