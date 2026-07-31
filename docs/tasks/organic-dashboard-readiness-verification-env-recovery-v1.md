# Organic Dashboard readiness verification environment recovery v1

## Incident

The guarded Organic Dashboard readiness refresh reached a successful 1D materialization and replay, then stopped in the separate read-only verifier:

```text
stage = read-lark-metric-rows
code  = ORGANIC_DASHBOARD_READINESS_VERIFY_VALUE_INVALID
field = LARK_TABLE_MKT_REPORT_METRIC_VALUES
```

The Report Finalizer had already resolved all six Report table mappings and converged the Lark schema, but those in-memory `environmentUpdates` were scoped to the Finalizer child process. The verifier started as a separate child, reloaded `.dev.vars`, and required the metric table mapping to be persisted there.

## Verified live boundary

```text
1D materialization             completed
same-report replay             completed
D1 materialization rows        1
Lark snapshot / metrics / top  1 / 17 / 5
D1-Lark mismatch               0
Worker restored all false      true
Provider calls                 0
Production                     blocked
```

The existing v5 evidence root contains a valid 1D closeout summary and no verification summary. It must not be replayed with the pre-fix code.

## Correction

- resolve Report table mappings through the existing read-only `planLarkReportSchema()` contract;
- require the complete Report schema to be clean before reading metric rows;
- do not require generated Table IDs to be manually copied into `.dev.vars`;
- permit only the safe partial state `closeout exists / verification missing`;
- validate the stored closeout before running the read-only verifier;
- never resend the stabilized closeout for that partial state;
- continue to reject `verification exists / closeout missing` and non-empty unrecognized attempt directories;
- expose `verificationOnlyRecoveryCount` in final evidence.

## Safety

Repository implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue/DLQ send, Provider request, Schedule/AI activation, Secret/config change or Production action.

After merge, continuation must use the retained v5 evidence root with the new exact merged Head. The corrected operator will rerun the converged Finalizer, recover 1D verification only, then execute missing 3D/7D/30D windows through the existing stabilized closeout.
