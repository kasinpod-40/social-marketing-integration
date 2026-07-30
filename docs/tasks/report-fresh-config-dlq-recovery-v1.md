# Report Fresh Configuration DLQ Recovery v1

## Incident

Organic TikTok 1D fresh materialization was submitted from the reviewed Report-only window, but the Queue consumer retained one permanent configuration DLQ before any Report run was admitted:

```text
dlq_id                 terminal:9073b534c14d227408bb8be1921bc0ad
message_id             9073b534c14d227408bb8be1921bc0ad
error_code             DASHBOARD_REPORT_CONFIGURATION_INVALID
retry_count            1
operation_id           null
generation/requested   1785410844381
materialization rows   0
successful runs        0
Worker safe restore    verified
```

3D and 7D are already complete and must be reused. 30D has not started.

## Correction

1. Add bounded Active deployment stabilization to the shared normal Report closeout before every Queue send.
2. Add exact 1D recovery pinned to the immutable DLQ, original job evidence, requested-at/generation and zero pre-existing D1/Lark Report rows.
3. Permit one exact first-materialization retry and one same-job replay only after a fresh D1 backup and three stable Active deployment samples.
4. Restore every Worker execution flag false in `finally`.
5. Close only the retained exact DLQ audit metadata after D1/Lark parity and replay idempotency pass.
6. Write the canonical 1D closeout summary, then reuse 3D/7D/1D and execute only 30D through the stabilized normal path.

## Safety

Repository implementation and CI perform no Remote Worker deployment, Queue/DLQ send, D1/Lark mutation, Provider request, Schedule/Secret change, Business fact deletion or Production action.

Live recovery remains blocked until exact-head Branch Verification passes and the reviewed PR is merged.
