# Chatwoot 1D D1-Complete / Lark-Incomplete Recovery v1

## Incident state

The exact Chatwoot 1D continuation was attempted after the post-PR #526 Finalizer succeeded on current main. The continuation stopped during read-only preflight before any Worker deployment or Queue send because the retained incident had advanced from the original failed-before-write state:

```text
report_id                 exact Chatwoot 1D report
materialization_count     1
sync_status               failed
successful_sync_count     0
active_lock_count         0
new_dlq_count             1
Lark snapshots            0
Lark metrics              0
activeDeploymentAttempted false
```

The failed continuation root is immutable:

```text
outputs/chatwoot-post-526-7db5470a/chatwoot-1d-exact-continuation
```

Do not rerun it.

## Interpretation

The exact incident binding remains valid: one retained failed Sync Run, one exact open Report DLQ replay payload, and one exact Critical Alert. `new_dlq_count=1` is the expected retained exact DLQ count from the original continuation contract, not evidence of an additional second DLQ.

The business state is now D1-complete / Lark-incomplete. Sending the Queue job again would violate the exact recovery boundary and could duplicate work.

## Recovery design

Add a narrow exact recovery operator that reuses existing shared components:

```text
existing report_materializations row
→ D1ReportMaterializationReader
→ writeDashboardMaterializationToLark
→ LarkRecordRepository
→ TableSyncEngine
→ verify D1/Lark integrity
→ close exact retained DLQ + Alert
```

No new materialization engine, queue framework, D1 writer, Lark sync engine or Worker deployment path is introduced.

## Exact admission

Recovery is admitted only when all of the following remain true:

- exact retained incident Sync Run/DLQ/Alert binding passes;
- source coverage remains complete;
- pending D1 migrations = 0;
- exact report ID is present once in D1;
- retained sync status remains `failed` and successful sync count remains 0;
- active Report lock count = 0;
- exact retained DLQ count = 1;
- D1 payload checksum exists;
- Lark Snapshot/Metric/Top Content/Top Ads counts are all 0;
- duplicate metric key count = 0;
- Finalizer evidence belongs to exact current clean main.

Any drift fails closed before mutation.

## Mutation boundary

The recovery may perform only:

1. Shared Lark projection for the already-existing exact D1 materialization.
2. Exact retained DLQ metadata closure and exact retained Critical Alert resolution after integrity passes.

It must perform:

```text
Queue sends             0
Worker deployments      0
Provider requests       0
Report identity changes 0
Business fact deletes   0
Notification Admission  false
Schedule                disabled
Production              BLOCKED
```

## Required recovered state

```text
D1 materialization      1
Lark Snapshot           1
Lark Metrics            139
Lark Top Content        0
Lark Top Ads            0
Duplicate metric keys   0
Exact D1/Lark integrity PASS
Retained DLQ            redriven/completed
Retained Alert          resolved
Open Report DLQ         0
Open Report Critical    0
```

The historical failed Sync Run remains historical evidence and is not rewritten to success.

## Post-merge sequence

1. Sync clean exact merged main.
2. Run a new current-head Finalizer under a new evidence root if the merge changes main SHA.
3. Run this exact D1/Lark recovery once under a brand-new immutable evidence root.
4. Run fresh SELECT-only Chatwoot readiness.
5. Require 1D `reuse_or_idempotent_verify` and 3D/7D/30D fresh or otherwise justified by readback.
6. Generate a new Chatwoot channel authority/handoff; never reuse the stale pre-incident handoff.
7. Continue only remaining windows under a new reviewed closeout root.
