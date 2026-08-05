# Multichannel Report Verified-Reuse No-Resend Hotfix v1

Date: `2026-08-05`

## Objective

Fix the shared reviewed multiwindow Report executor after the resumed Run All submitted a newly constructed Queue
job for a window already classified as `reuse_or_idempotent_verify`. Verified reuse must remain read-only and must
not fabricate same-input replay evidence across different requested-at identities.

## Incident evidence

The exact Facebook 1D configuration-DLQ recovery completed successfully on merged
`main@bae7eec0d3845eb1094140f6e16bd0b6677b4223` with:

```text
Report ID                 integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:facebook-organic-v1
D1 materializations       1
Successful recovery runs  2
Same Report ID            true
Same payload checksum     true
D1/Lark unchanged         true
DLQ closed                true
Worker baseline restored  true
```

The next all-channel readiness pass correctly selected Facebook 1D as
`reuse_or_idempotent_verify`. During Run All, the executor generated a new candidate with a new `requestedAt`, sent
it through the unconditional replay path and stopped at:

```text
REPORT_RUNTIME_CLOSEOUT_REPLAY_DRIFT
```

Before that assertion, `assertReportRuntimeCloseoutCompletion()` passed. Therefore the second delivery had already
reached one Stable D1 materialization, successful Sync status, zero active lock and zero new Report DLQ. The
preserved Notification Runtime baseline was restored. No Provider request, Schedule or Production activation
occurred.

## Defect

The executor's existing `verify` path did not send the first job, but still always sent the later replay job. Its
`before` value came from an older materialization while the replay job was regenerated with a new requested-at
value. It then labelled the operation `sameInput: true` and required the old and new payload checksum to match.

A generic retained handoff does not contain the byte-identical original Queue job for every pre-existing Report
window. Therefore a verified existing window cannot truthfully be replayed by constructing a new job. The correct
meaning of `reuse_or_idempotent_verify` is to reuse the already verified D1/Lark state with zero Queue mutation.

## Architecture

Use the existing shared flow only:

```text
Readiness action
├─ create_materialization
│  → first Queue job
│  → D1/Lark completion
│  → exact same-job replay
│  → zero-drift proof
├─ refresh_or_repair_materialization
│  → repair Queue job
│  → D1/Lark completion
│  → exact same-job replay
│  → zero-drift proof
└─ reuse_or_idempotent_verify
   → existing D1/Lark integrity proof
   → local reuse evidence
   → zero Queue messages
```

No new Report engine, Queue framework, Reliability layer, D1 writer or Lark writer is permitted.

## Scope

### In scope

- early return for `selected.operation === 'verify'` in the existing shared executor;
- local private attempt evidence named `*-reuse-verified.attempt.json`;
- truthful reuse summary fields;
- unchanged successful-run floor for reuse;
- unchanged first-send/replay behavior for fresh and refresh operations;
- focused source-wiring regression plus full Repository gates;
- exact-main post-merge readiness-first resume sequence.

### Out of scope

- any additional Facebook 1D Queue message before new readiness evidence;
- generic rerun of the failed Run All command;
- DLQ redrive or deletion;
- replacement Report ID or manual checksum restoration;
- D1/Lark manual editing;
- Provider or source ingestion;
- Schedule, Notification Admission or Production.

## Safety contract

A verified-reuse result must contain:

```text
executionMode       reuse_verified_materialization
reusedExisting      true
replayExecuted      false
sameInput           null
sameReportId        true
samePayloadChecksum true
zeroDrift           true
queueMessagesSent   0
```

It may be emitted only after the existing prestate has already passed:

- one exact D1 materialization;
- one Lark Snapshot set;
- non-empty Metrics;
- zero duplicate metric keys;
- exact D1/Lark metric-key and value integrity.

## Acceptance criteria

1. The verify branch returns before the first reachable `sendReviewedQueueMessage()` call.
2. Verify writes no Queue attempt and increments no successful-run counter.
3. Verify writes one private local reuse evidence file.
4. Fresh and refresh keep two-message first/replay behavior.
5. Active Worker deployment stability and baseline restore remain unchanged.
6. Existing Recovery, Run All and retained-handoff contracts continue to pass.
7. Post-merge Facebook readiness must prove current D1/Lark integrity and zero Work/Lock/DLQ before Run All resumes.
8. No Provider, Schedule, Notification Admission or Production action occurs during implementation.

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

## Remote boundary

Repository implementation performs zero Remote action. After merge, the operator must first run exact-head
Finalizer and SELECT-only Facebook readiness. A mismatch or blocker stops before Queue admission. Only a newly built
exact-head retained handoff may authorize the resumed Run All.
