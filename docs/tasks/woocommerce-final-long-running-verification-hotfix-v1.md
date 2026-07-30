# WooCommerce Final Long-running Verification Hotfix v1

## Incident

The manifest-gated Final Delivery execution admitted exact WooCommerce operation
`woo-final-full-011368480910`. The operation continued writing 2026 data successfully, but the
operator stopped with `WOOCOMMERCE_FINAL_VERIFY_TIMEOUT` after the fixed verification window.

Observed terminal snapshot at operator timeout:

```text
sync_run_status              running
work_lifecycle_status        active
active_lock_count            1
queue_operation_attempts     6
dataset_index                1
page                         10
failed_rows                  0
raw_commerce_orders          1000
state.lark_rows              3904
```

The automatic all-false Safe restore passed. Meta did not start. This is not a permanent operation
failure and does not authorize a replacement operation.

## Root cause

The reviewed core defaults were:

```text
MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS  240
MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS 5000
maximum verification time               20 minutes
```

The fixed time budget was shorter than the valid processing time for the approved 2026 dataset and
Lark writes. The core correctly classified the operation as neither complete nor terminal, but
exhausted the local watcher before the durable Queue workflow completed.

## Correction

The public WooCommerce Final entrypoint now supplies bounded long-running defaults only when the
operator has not explicitly supplied an override:

```text
maximum polls     2160
interval          5000 ms
hard bound        3 hours
```

The reviewed immutable core remains unchanged. It still:

- returns immediately on exact completion;
- fails immediately on a current-attempt permanent terminal failure;
- applies automatic all-false Safe restore on failure;
- retains existing explicit environment overrides;
- performs no unbounded wait.

## Current operation safety

Before any new Remote action, the exact operation must be inspected read-only until its active lock
is zero. A replacement full operation is forbidden. The next path must either resume
`woo-final-full-011368480910`, continue from its completed full state, or stop for exact settled-error
review.

## Verification

Required:

```text
focused long-running verification source regressions
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

Repository implementation and CI perform no Provider request, Worker upload/deployment, Queue
message, Remote D1/Lark mutation, Meta execution, Schedule change or Production action.
