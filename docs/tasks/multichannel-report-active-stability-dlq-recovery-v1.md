# Multichannel Report Active Stability & Facebook DLQ Recovery v1

## Objective

Recover the exact unmaterialized Facebook Organic 1D Report job from the interrupted Multichannel Run All and
prevent the same deployment race across every reviewed Report channel by reusing the existing stable Active Worker
barrier in the shared remote verifier.

## Incident boundary

The first Run All Queue admission produced one open Report DLQ and no Report execution state:

```text
platform             facebook
capability           organic
window               1D
report ID            integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:facebook-organic-v1
requested-at         1785918760577
job SHA-256          cee6c82f7732ab99d5f81d8e70c6108a33bed95b1b685d007c50d3f6122bd298
DLQ                  terminal:4c366c2b02ad5162c6e4035899d67abc
error                DASHBOARD_REPORT_CONFIGURATION_INVALID
sync runs            0
materializations     0
active Work/Lock     0 / 0
Worker restore       verified preserved Notification baseline
```

The Worker gate rejects this error before `runReliableSync`. The retained Queue replay payload and locally
regenerated reviewed job are the same exact payload. The only missing reliability condition was a stable-deployment
barrier between immediate deployment readback and Queue processing.

## Shared correction

`createReviewedRemoteRuntime().verifyDeployment(mode, expectedVersionId)` now has two modes:

- bootstrap/current-baseline inspection without an expected version remains one read;
- any exact newly deployed version requires full verification at `0 / 10 / 20` second delays.

Every exact sample must retain:

- the expected version at 100% traffic;
- exact reviewed true flags;
- exact D1 database binding;
- exact main Queue binding;
- every required Report, operational and Notification Lark mapping.

The complete sample fingerprint must remain identical. The same rule applies to Active Report windows and the
preserved baseline restore.

## Exact recovery sequence

1. Require clean current `main == origin/main` and exact current-head Finalizer evidence.
2. Prove the original incident Head is an ancestor.
3. Load and validate the retained Facebook 1D send attempt.
4. Read the exact DLQ and its operation metadata.
5. Regenerate the exact original job and require byte-equivalent JSON to the retained replay payload.
6. Require account-daily Facebook source facts, no active Report work/lock, one exact open Report DLQ and zero target
   D1/Lark rows.
7. Create a fresh private Remote D1 backup.
8. Deploy the reviewed Report Active configuration and pass three stable samples.
9. Record the attempt, send the exact original first-materialization job once and verify D1/Lark completion.
10. Record and send the exact same job once as replay; verify one Report row, equal checksum and zero D1/Lark drift.
11. Restore the preserved Notification Runtime baseline in `finally` and pass three stable samples.
12. Close only the exact retained DLQ and operation metadata under one immutable recovery reference.
13. Write a private sanitized summary.

## Safety

```text
Provider request                  0
New Report identity              0
Blind Run All rerun              forbidden
Generic DLQ redrive              forbidden
Business/Coverage mutation       0
Manual Lark editing              0
Notification Admission           false
Schedule                         false
Production                       BLOCKED
```

Repository implementation and CI perform no Remote action. Live recovery remains separately confirmation-gated
and may run only after exact-head review, merge, main synchronization and Finalizer rerun.

## Failure semantics

- Every mutation attempt is written privately before execution.
- A prior partial attempt blocks automatic repetition.
- Any exact-identity, payload, source, target, migration, deployment, D1/Lark or restore mismatch fails closed.
- DLQ closure occurs only after first materialization, replay, D1/Lark parity and preserved-baseline restore all pass.
- The DLQ row remains forensic evidence with `redriven` status; it is never deleted.

## Verification

```bash
npm ci
npm run check
node --test \
  tests/scripts/report-runtime-closeout-reviewed-remote.test.js \
  tests/scripts/report-runtime-reviewed-config-dlq-recovery.test.js
node --test \
  tests/scripts/report-runtime-closeout-reviewed-multiwindow-wiring.test.js \
  tests/scripts/report-all-ready-channels.test.js \
  tests/scripts/retained-multichannel-report-handoff.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
