# Project Brain — Multichannel Report Verified-Reuse No-Resend

Date: `2026-08-05`

## Locked state

The exact Facebook Organic 1D configuration-DLQ recovery passed on
`main@bae7eec0d3845eb1094140f6e16bd0b6677b4223`. It retained one Report ID, one D1 materialization, equal recovery
and replay checksum, unchanged Lark rows/integrity, two successful Sync Runs, a closed forensic DLQ and a verified
preserved Notification Runtime baseline.

The subsequent Run All stopped safely on the same Facebook 1D window with
`REPORT_RUNTIME_CLOSEOUT_REPLAY_DRIFT`. Before that drift assertion, the new delivery passed the normal completion
assertion, proving:

```text
D1 materialization count  1
Sync status               success
Active Report lock        0
New Report DLQ            0
Worker baseline restore   verified
Provider requests         0
Notification Admission    false
Schedules                 false
Production                BLOCKED
```

Facebook 3D/7D/30D and every later channel did not start. Post-delivery Lark parity is intentionally unclaimed until
a new SELECT-only readiness pass.

## Root-cause decision

The shared executor generated all current candidates with one new `requestedAt = Date.now()`. For a
`reuse_or_idempotent_verify` window, it loaded the prior materialization as `before`, skipped the first send, but
still unconditionally submitted the newly generated candidate through `send-replay` and labelled it
`sameInput: true`.

That is invalid by construction: an existing materialization and a newly generated requested-at job are not the
same input. The generic retained handoff does not retain every historical Queue job payload. The observed checksum
drift is therefore a verifier/execution-policy defect, not evidence that the Stable Report ID duplicated or that
Facebook source facts failed.

## Locked correction

`reuse_or_idempotent_verify` means read-only reuse:

```text
existing D1 row
+ existing Lark rows
+ exact D1/Lark integrity
→ local reuse evidence
→ zero Queue messages
```

Only `create_materialization` and `refresh_or_repair_materialization` use the existing first-send plus byte-identical
same-job replay path.

## Required reuse evidence

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

The current-run successful Sync floor is not incremented by reuse, so later fresh/repair windows continue to count
only Queue work admitted by that run.

## Forbidden actions

- rerun the failed Run All block or its old retained handoff;
- send another Facebook 1D Queue job before exact-head readiness;
- manually restore the prior checksum in D1 or Lark;
- treat the new successful Sync delivery as a DLQ incident;
- create a Facebook-only Report engine or recovery wrapper;
- enable Provider ingestion, Schedule, Notification Admission or Production.

## Post-merge sequence

1. synchronize clean exact `main`;
2. rerun Report Runtime Finalizer;
3. run Facebook SELECT-only readiness first;
4. require one materialization, D1/Lark integrity, zero Work/Lock/DLQ and
   `1D:reuse_or_idempotent_verify`;
5. rerun readiness for the remaining six ready channels;
6. build a new exact-head retained handoff;
7. resume Run All once; Facebook 1D must emit verified reuse evidence with zero Queue messages;
8. stop on any later channel failure and never rerun blindly.
