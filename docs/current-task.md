# Current Task — Multichannel Report Active Stability & Facebook DLQ Recovery v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = MULTICHANNEL_REPORT_ACTIVE_STABILITY_DLQ_RECOVERY_V1
BRANCH                              = hotfix/multichannel-report-active-stability-dlq-recovery-v1
EXACT_BASE                          = 158f881a61b3a41bb219b8990c59099777fb68f4
LIVE_RUN_ALL_RESULT                 = STOPPED_SAFE_ON_FACEBOOK_1D
FACEBOOK_1D_MATERIALIZATION         = NOT_CREATED
FACEBOOK_REPORT_SYNC_RUN            = NOT_CREATED
EXACT_OPEN_REPORT_DLQ               = 1
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_RUNTIME_STATE          = active
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/multichannel-report-active-stability-dlq-recovery-v1.md
```

## Goal

Correct the shared reviewed Report closeout path so every newly deployed Active or restored Worker version is
stable across three exact version/traffic/flag/binding observations before any Queue send or successful restore
claim. Recover only the retained Facebook Organic 1D configuration DLQ created by the interrupted Run All, prove
first materialization plus same-job replay and D1/Lark parity, restore the preserved Notification Runtime baseline,
then close only that exact DLQ incident.

## Confirmed incident evidence

The first Run All channel stopped on Facebook Organic 1D after the original Queue send. Read-only Remote evidence
proves:

- retained attempt report ID:
  `integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:facebook-organic-v1`;
- requested-at `1785918760577`;
- exact job SHA-256 `cee6c82f7732ab99d5f81d8e70c6108a33bed95b1b685d007c50d3f6122bd298`;
- exact DLQ `terminal:4c366c2b02ad5162c6e4035899d67abc`;
- error `DASHBOARD_REPORT_CONFIGURATION_INVALID` with message
  `Dashboard report requires a reviewed D1-primary job contract`;
- zero Facebook Report Sync Runs and zero target materializations;
- zero active Work/Lock and exactly one open Report DLQ;
- Facebook Account Daily source facts remain valid with two account facts;
- Worker returned to the preserved active Notification Runtime baseline;
- Provider, Schedule, Notification Admission and Production actions remain zero/disabled.

The retained replay payload hash equals the reviewed local job hash. The Worker rejected the job before
`runReliableSync`, so this is not a source-data, adapter, Stable-key or Report-identity defect. The shared operator
verified the newly deployed Active version only once before sending. The existing exact TikTok configuration-DLQ
recovery already requires three stable Active deployment samples. This work extends that existing reliability
barrier to the shared reviewed remote verifier.

## In scope

- extend the existing reviewed Worker verifier with three exact deployment samples at `0 / 10 / 20` seconds;
- require the same stability barrier for Active Report windows and preserved baseline restore;
- exact immutable Facebook 1D incident contract;
- exact same-job first-materialization retry once;
- exact same-job replay once;
- D1 materialization, successful Sync Run, Lark stable rows and metric integrity verification;
- preserved Notification Runtime baseline restore in `finally`;
- exact DLQ and operation-metadata closure only after complete success;
- private sanitized evidence and regressions.

## Out of scope

- blind Run All rerun;
- replacement Report ID, requested-at or Queue payload;
- generic DLQ redrive;
- deleting forensic DLQ evidence;
- Provider request;
- Source/Coverage/Business-fact mutation;
- Lark manual editing;
- Report Schedule, Notification Admission or Production activation;
- new Report, Queue, Reliability, D1 or Lark framework.

## Acceptance criteria

1. Exact deployed Worker verification requires three identical samples of version, 100% traffic, true flags,
   D1/Queue bindings and required Lark table mappings before returning success.
2. Bootstrap baseline readiness remains one read and does not delay SELECT-only audits.
3. The recovery terminal requires clean current `main == origin/main`, current-head Finalizer evidence and ancestry
   of the original incident Head.
4. Retained attempt, regenerated candidate, replay payload, Report identity, requested-at, source watermark,
   DLQ identity, error and operation metadata must all match exactly.
5. Recovery starts only while target D1/Lark materialization state is completely empty and the exact one DLQ is
   the only Report blocker.
6. Before first retry, create a fresh private Remote D1 backup and verify three stable Active Worker samples.
7. Send the exact first-materialization job once, then verify one D1 materialization, one successful Sync Run and
   exact D1/Lark integrity.
8. Send the exact same job once for replay and verify one Stable Report identity, equal checksum and unchanged
   D1/Lark rows and integrity.
9. Restore and verify the preserved Notification Runtime baseline in `finally` with three stable samples.
10. Close only the exact retained DLQ and metadata after recovery and restore pass; interrupted attempts remain
    non-repeatable and fail closed.
11. Provider calls, Schedule, Notification Admission and Production remain disabled.

## Required verification

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

## Post-merge boundary

This branch performs no Remote action. After exact-head CI, review and merge:

1. synchronize clean `main`;
2. rerun the existing Report Runtime Finalizer for the new exact Head;
3. run the exact Facebook configuration-DLQ recovery terminal once;
4. inspect its final JSON and do not repeat a partial attempt;
5. after successful recovery, rerun SELECT-only readiness for all channels and rebuild the retained handoff;
6. only then resume the existing Run All path, which will inherit the stable deployment barrier.

Schedules, Notification Admission and Production remain blocked after Report materialization.
