# Chatwoot Prior Selection Handoff v1

## Incident

The verified prior-attempt wrapper accepted the retained safe-baseline attempt under Head
`87d9235d7a8b5982e9bfa8a40e1fd3218a77f79c`, confirmed the current Worker was all-false and matched the retained safe-restore fingerprint, then delegated to the existing exact chain on `main@3d18effdf1865795ab183449102fc86e33fec287`.

The inner safe-baseline selector stopped before promotion with:

```text
code                       CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS
candidateCount             2
baselineVersionMatchCount  0
```

Provider, Queue, Remote D1, Remote Lark, Worker deployment and incident-closure actions were all zero. Schedule and Webhook remained disabled and Production remained blocked.

## Root cause

The prior-attempt validator proves the current all-false Worker version against `02-safe-restore.json`. That version can be an inner replacement Safe version rather than either original controller candidate's baseline version.

The inner safe-baseline selector ignored the prior attempt's already-validated retained session, baseline-version and active-version fingerprints and still selected only by exact equality between the current Worker UUID and each candidate baseline UUID. The current replacement Safe version therefore matched neither candidate even though the prior attempt had already bound one exact candidate identity.

## Correction

1. Keep ordinary safe-baseline selection unchanged: zero enabled flags and exactly one candidate whose baseline version equals the current all-false Worker version.
2. When `MKT_CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_HEAD` is present, the inner safe-baseline authority independently reloads and validates that prior directory with `loadChatwootSafeBaselinePriorAttempt`.
3. The prior Head must be a strict ancestor of the current reviewed Head.
4. The selector binds candidates by the exact triple already retained by the prior attempt:
   - retained session fingerprint;
   - direct SHA-256 baseline-version fingerprint;
   - direct SHA-256 active-version fingerprint.
5. Exactly one fingerprint match is required. Zero or multiple matches fail closed before promotion.
6. The new current-head active-window attempt records:
   - `selectedBy=verified_prior_safe_baseline_attempt`;
   - `priorAttemptHead`;
   - `priorAttemptValidated=true`.
7. Downstream inspector and arbitration handoff validation accepts that authority only with the required prior fields and rejects ordinary handoffs containing prior-attempt fields.
8. Retained evidence is not edited, deleted, renamed or overwritten.
9. Existing Remote D1 boundary inspection, retained active-version verification, Worker promotion, pinned-origin arbitration, Initial recovery, Queue continuation, Lark parity, incident closure and all-false Safe restore authorities remain unchanged.
10. A second Initial admission remains forbidden. Schedule/Webhook stay disabled and Production stays blocked.

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

## Verification

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

Repository implementation and CI perform no Live or Remote mutation.
