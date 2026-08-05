# Current Task — Multichannel Report Verified-Reuse No-Resend Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = MULTICHANNEL_REPORT_VERIFIED_REUSE_NO_RESEND_V1
BRANCH                              = hotfix/report-reuse-verification-no-resend-v1
EXACT_BASE                          = bae7eec0d3845eb1094140f6e16bd0b6677b4223
PRIOR_FACEBOOK_DLQ_RECOVERY         = PASS
SECOND_RUN_ALL_RESULT               = STOPPED_SAFE_ON_FACEBOOK_1D_REUSE
FACEBOOK_1D_MATERIALIZATION_COUNT   = 1
FACEBOOK_1D_SYNC_COMPLETION         = PASS
NEW_REPORT_DLQ_COUNT                = 0
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_RUNTIME_STATE          = active
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/multichannel-report-verified-reuse-no-resend-v1.md
```

## Goal

Correct the shared reviewed multiwindow executor so a readiness action of
`reuse_or_idempotent_verify` reuses the already verified D1/Lark materialization without submitting a newly
constructed Queue job. Fresh and repair windows continue to use the existing first-send plus exact same-job replay
path. Resume remains blocked until the hotfix is merged, exact-main Finalizer/readiness pass and the current
Facebook 1D D1/Lark state is reverified read-only.

## Confirmed second incident

After exact Facebook 1D configuration-DLQ recovery completed, all-channel readiness classified Facebook 1D as:

```text
reuse_or_idempotent_verify
```

The reviewed executor then:

1. loaded the recovered D1/Lark row as `before`;
2. generated a new candidate job using a new `requestedAt = Date.now()`;
3. unconditionally sent that new job through the code path named `send-replay`;
4. observed a successful Report Sync completion with one Stable materialization, zero active lock and zero new DLQ;
5. stopped at `REPORT_RUNTIME_CLOSEOUT_REPLAY_DRIFT` because the newly submitted job was not the same input as the
   retained recovered materialization;
6. restored the preserved Notification Runtime Worker baseline successfully.

The ordering of assertions proves the second Queue delivery reached a valid completed D1 state before the drift
assertion. Facebook 3D/7D/30D and every later channel were not started. Lark post-delivery parity remains unclaimed
until the next SELECT-only readiness pass.

## Root cause

`executeWindow()` treated all operations as requiring a Queue replay. For `verify`, its `first` value is an existing
materialization created by an earlier job, while `selected.job` is regenerated with a new requested-at value. The
operator nevertheless labelled the delivery `sameInput: true` and compared the new result to the older checksum.
That is a shared execution-policy defect, not a Facebook source, Report ID, D1 row-count or deployment-stability
defect.

## In scope

- change only the existing shared reviewed multiwindow executor;
- make `verify` a read-only reuse result with zero Queue messages;
- persist a private local `reuse-verified` attempt record;
- retain D1/Lark integrity validation before the reuse result;
- keep first-send plus exact same-job replay unchanged for `fresh` and `refresh`;
- preserve successful-run floors for later mutating windows;
- expose truthful summary fields: `reusedExisting`, `replayExecuted`, `executionMode` and `queueMessagesSent`;
- focused regression, full Repository gates and updated handoff documentation.

## Out of scope

- another Queue message for Facebook 1D;
- generic rerun or DLQ redrive;
- replacing the Facebook Report ID;
- restoring an older payload checksum by manual D1/Lark writes;
- Provider request or source ingestion;
- new Report/Queue/Reliability/D1/Lark framework;
- Schedule, Notification Admission or Production activation.

## Acceptance criteria

1. `verify` returns only after one D1 materialization, one Lark Snapshot set, no duplicate metric keys and exact
   D1/Lark metric integrity have already passed.
2. `verify` writes local sanitized evidence and performs zero Queue send.
3. `verify` does not increment the current-run successful Sync floor.
4. `verify` reports `executionMode=reuse_verified_materialization`, `reusedExisting=true`,
   `replayExecuted=false`, `sameInput=null`, `queueMessagesSent=0` and `zeroDrift=true`.
5. `fresh` and `refresh` still submit one first job plus one byte-identical replay and retain all existing completion,
   Stable-ID, checksum, Lark and integrity assertions.
6. Active deployment stability and preserved Notification Runtime restore remain unchanged.
7. Post-merge execution starts with SELECT-only readiness; any D1/Lark mismatch, Work/Lock/DLQ or source drift stops
   before another Queue message.
8. Provider, Schedule, Notification Admission and Production remain disabled.

## Implementation result

In progress on the branch above:

- added an early verified-reuse return before the shared Queue send path;
- recorded a private `*-reuse-verified.attempt.json` evidence file;
- made reuse summary semantics explicit and truthful;
- retained the existing materialize-and-replay path for fresh/repair windows;
- strengthened the existing executor wiring regression so the verify branch must return before any
  `sendReviewedQueueMessage` call.

No Remote action was performed by this Repository implementation.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-closeout-reviewed-multiwindow-wiring.test.js
node --test \
  tests/scripts/report-runtime-closeout-reviewed-remote.test.js \
  tests/scripts/report-runtime-reviewed-config-dlq-recovery.test.js \
  tests/scripts/report-all-ready-channels.test.js \
  tests/scripts/retained-multichannel-report-handoff.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge boundary

1. synchronize clean exact `main`;
2. rerun Report Runtime Finalizer for the new exact Head;
3. rerun SELECT-only readiness for Facebook first;
4. require one materialization, D1/Lark integrity, zero Work/Lock/DLQ and action
   `reuse_or_idempotent_verify` for Facebook 1D;
5. rerun SELECT-only readiness for the remaining channels and rebuild the exact-head retained handoff;
6. resume Run All once under the corrected shared executor;
7. never repeat the failed `bae7eec...` Run All command or its generated handoff.

Schedules, Notification Admission and Production remain blocked after Report materialization.
