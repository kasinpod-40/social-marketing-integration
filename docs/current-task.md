# Current Task — Chatwoot 1D D1-Complete / Lark-Incomplete Recovery v1

## Status

```text
TASK_STATUS                  = IMPLEMENTATION_COMPLETE_CI_PENDING
CURRENT_PROGRAM              = CHATWOOT_1D_D1_COMPLETE_LARK_INCOMPLETE_RECOVERY_V1
BRANCH                       = hotfix/chatwoot-1d-d1-complete-lark-recovery-v1
EXACT_BASE                   = 7db5470ac9db48e6e46b8629d34e7d1f04e60804
FAILED_CONTINUATION_STAGE    = exact-incident-read-only-preflight
FAILED_CONTINUATION_CODE     = REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_INITIAL_STATE_MISMATCH
D1_MATERIALIZATION_COUNT     = 1
RETAINED_SYNC_STATUS         = failed
SUCCESSFUL_SYNC_COUNT        = 0
ACTIVE_LOCK_COUNT            = 0
EXACT_RETAINED_DLQ_COUNT     = 1
LARK_SNAPSHOT_COUNT          = 0
LARK_METRIC_COUNT            = 0
ACTIVE_DEPLOYMENT_ATTEMPTED  = false
QUEUE_ACTION_FROM_FAILED_RUN = 0
PRODUCTION                   = BLOCKED
```

Full contract:

```text
docs/tasks/chatwoot-1d-d1-complete-lark-incomplete-recovery-v1.md
```

## Goal

Recover the exact retained Chatwoot 1D Report materialization from the current D1-complete / Lark-incomplete state without resending Queue work or deploying a Worker.

## Exact state interpretation

The post-PR #526 Finalizer passed on `main@7db5470ac9db48e6e46b8629d34e7d1f04e60804`. The next Chatwoot continuation then stopped before any active Worker deployment because its old admission contract expected `materialization_count=0`, while the exact report now exists once in D1 and remains absent from Lark.

`new_dlq_count=1` is the retained exact DLQ expected by the original continuation contract; it is not a second additional DLQ.

The failed continuation evidence is immutable:

```text
outputs/chatwoot-post-526-7db5470a/chatwoot-1d-exact-continuation
```

Do not rerun or delete it.

## Implementation result

This workstream adds a narrow exact recovery operator that reuses the existing shared components:

```text
existing exact report_materializations row
→ D1ReportMaterializationReader
→ writeDashboardMaterializationToLark
→ LarkRecordRepository
→ TableSyncEngine
→ D1/Lark integrity verification
→ exact retained DLQ + Critical Alert closure
```

The recovery operator contains no Queue send or Worker deployment path.

## Admission boundary

Before mutation it requires:

- clean current `main`;
- exact current-head Finalizer evidence;
- pending D1 migrations = 0;
- source/runtime preflight unchanged and complete;
- exact retained Sync Run, DLQ replay payload and Critical Alert binding;
- exact report ID in D1 once;
- retained sync status `failed` and successful sync count 0;
- active Report lock count 0;
- exact retained DLQ count 1;
- non-empty payload checksum;
- Lark Snapshot/Metric/Top rows all 0;
- duplicate metric keys 0.

Any drift fails closed before mutation.

## Required recovered state

```text
D1 materialization       1
Retained Sync status     failed (historical evidence preserved)
Lark Snapshot            1
Lark Metrics             139
Lark Top Content         0
Lark Top Ads             0
Duplicate metric keys    0
D1/Lark integrity        PASS
Retained DLQ             closed/completed
Retained Critical Alert  resolved
Open Report DLQ          0
Open Report Critical     0
Queue sends              0
Worker deployments       0
Provider requests        0
Notification Admission   false
Schedule                 disabled
Production               BLOCKED
```

## Prohibited actions

- rerun the failed continuation root;
- resend the Chatwoot 1D Queue job;
- deploy an active Report Worker for this recovery;
- create a replacement Report ID;
- rewrite the retained failed Sync Run to success;
- close DLQ/Alert before D1/Lark integrity passes;
- delete Business facts or legacy evidence;
- enable Notification Admission, Schedule or Production.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery-source.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-incident-continuation.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run a current-head Finalizer under a brand-new evidence root because merge changes the main SHA;
3. run the D1-complete / Lark-incomplete recovery once under a brand-new immutable root;
4. require D1 `1`, Lark `1/139`, duplicate `0`, integrity PASS, Queue `0`, Worker deployment `0`, exact DLQ/Alert closure;
5. run fresh SELECT-only Chatwoot readiness;
6. require 1D reuse/idempotent verify and derive current state of 3D/7D/30D from readback;
7. generate a new Chatwoot channel handoff; never reuse the stale handoff from before this incident;
8. close only remaining windows under a new reviewed root.
