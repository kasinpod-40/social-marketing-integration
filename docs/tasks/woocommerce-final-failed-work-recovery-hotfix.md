# WooCommerce Final Failed-work Recovery Hotfix

## Incident evidence

The source-safe WooCommerce rollout operation stopped before the first Provider response and automatic Safe restore completed:

```text
operation_id          = woo-final-full-e6cd0e1b227f
sync_run_status       = failed
sync_run_error_code   = WOOCOMMERCE_NETWORK_ERROR
work_lifecycle_status = active
active_lock_count     = 0
records_pulled        = 0
records_written       = 0
phase                 = woocommerce_commerce_pages_v1
phase_complete        = 0
datasetIndex          = 0
page                  = 1
```

The merged source-contract hotfix closes the strongest observed configuration gap by materializing the exact Chemistry K origin into generated Safe/UAT/Scheduled configs. However the existing Final remote preflight rejects every `sync_work_runs.lifecycle_status='active'` row, so the failed durable work must be classified before another rollout can start.

## Shared Core authority

`D1ResumableWorkStore.abandonWork()` defines the existing terminal lifecycle semantics:

- change `sync_work_runs.lifecycle_status` to `terminal`;
- preserve phase rows and work units;
- preserve generation fences;
- record terminal reason, abandoned time, retention expiry and audit reference;
- delete no Business facts.

The hotfix follows that contract rather than inventing a second recovery engine.

## Recovery eligibility

A work row is recoverable only when all conditions are true:

```text
work_key matches        woocommerce:woo-final-(full|incremental)-<12 hex>
lifecycle_status        active
matching sync_run       exists
sync_run.status         failed
active lock count       0
```

The discovery is bounded to at most 20 rows. Any running/non-failed operation, malformed key, duplicate row, active lock or excessive set fails closed.

## Guarded mutation

For each exact eligible work key, the launcher updates only `sync_work_runs`:

```text
lifecycle_status = terminal
terminal_reason  = woocommerce_final_failed_sync_recovery
abandoned_at     = set once
expires_at       = seven-day retention, set once
audit_reference  = repository-head-bound, set once
updated_at       = current time
```

The UPDATE repeats every eligibility guard and must report exactly one changed row. It does not mutate:

- WooCommerce Raw/Canonical/Daily Business tables;
- `sync_work_phases` or `sync_work_units`;
- `sync_generation_fences`;
- Queue operation attempts or DLQ evidence;
- Lark records;
- Worker deployment or Schedule.

After recovery, a global read requires zero active work and zero active locks before delegating to the existing source-safe and propagation-safe Final rollout.

## Execution authority

Recovery is unavailable in plan mode and requires the same exact Final confirmation:

```text
CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT
```

No Remote action is performed during Repository implementation or CI.

## Final command after merge

```bash
git switch main &&
git pull --ff-only &&
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
  node scripts/woocommerce-final-one-command-source-safe.mjs --execute
```

The command should print these sanitized stages before the original Final rollout stages:

```text
woocommerce-final-source-contract-materialized
woocommerce-final-failed-work-recovery
woocommerce-initial-queue-propagation-barrier
```
