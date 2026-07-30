# Report Runtime Configuration DLQ Recovery v1

## Incident

The Organic TikTok 3D window completed its first materialization and the exact Lark nullable-metric repair converged D1/Lark parity. The missing-replay recovery then deployed the reviewed Report-only Worker window and submitted the exact same replay job, but the Queue consumer retained one permanent DLQ incident:

```text
dlq_id                       terminal:cb455db34ca87cf5f621d748be80d451
job_type                     report.materialization.generate
error_code                   DASHBOARD_REPORT_CONFIGURATION_INVALID
retry_count                  1
main_queue_attempts          1
operation_id                 null
generation/requested_at      1785385276557
successful Report runs       1
materialization rows         1
active lock                  0
Worker safe restore          verified
```

The incident occurred before a new Report reliability run was admitted. No second D1 materialization or Lark write was produced.

## Confirmed application gate

The exact replay job is reconstructed by `buildDashboardPresetJob()` and therefore has:

```text
type              report.materialization.generate
trigger           dashboard_preset
periodKind        rolling_days
reportRequestId   absent
windowDays        3
```

For TikTok, `DASHBOARD_REPORT_CONFIGURATION_INVALID` can then be emitted only when the consuming Worker invocation observes `MKT_REPORT_D1_READ_ENABLED !== true`. The deployment inventory had already reported the reviewed Active version and true Report flags, so the correction treats this as an Active-deployment/Queue-consumer binding convergence gap rather than changing the Report job contract.

## Correction

Add exact operator:

```text
scripts/report-runtime-config-dlq-recovery.mjs
```

The operator is pinned to the immutable incident, original Report ID, payload checksum, original requested-at/generation, job hash and prior evidence. It performs:

```text
current-main Finalizer
→ validate historical metric-null repair summary
→ verify Worker all-false
→ verify exact open DLQ and no foreign open Report DLQ
→ verify one D1 materialization, one prior successful run and fresh D1/Lark parity
→ fresh Remote D1 backup
→ deploy reviewed Report-only Active config
→ require the same Active version and true flags across 3 bounded samples
→ record retry attempt before send
→ send the exact same replay job once
→ require success count >= 2, one materialization, same checksum, zero lock and zero DLQ created after retry time
→ verify Lark rows and metric integrity unchanged
→ restore all Worker execution flags false in `finally`
→ retain and close only the exact DLQ/recovery metadata row
→ verify zero open Report DLQ
→ write the canonical 3D closeout summary
→ resume 7D refresh, 1D create and 30D create through the existing window sequence
```

## Resume rules

- No recorded retry send: one exact retry is permitted after backup and stable Active samples.
- Recorded retry send: verification-only; no Queue send is repeated.
- Deployment attempt without retry-send evidence: fail closed for operator inspection.
- Successful retry with incomplete DLQ metadata closure: exact-reference closure resumes idempotently.
- Existing verified 3D summary: reuse without deployment, Queue send or D1 mutation.

## Mutation allowlist

After the retry has succeeded and the Worker has returned all-false:

```text
dead_letter_jobs
  status / redrive audit fields only

dead_letter_operation_metadata
  recovery status/reference/audit fields only
```

Forbidden:

- Report materialization mutation outside the normal idempotent Queue path
- Organic Business/Coverage row mutation or deletion
- Lark manual write
- Queue delete or generic redrive
- Connector/Provider call
- Schedule, AI or Production activation

## Required verification

```text
focused exact incident/helper/source-order tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI on exact PR head
```

Repository implementation and CI perform no Remote Worker deployment, Queue/DLQ send, D1/Lark mutation, Provider request, Schedule change, Secret change or Production action.
