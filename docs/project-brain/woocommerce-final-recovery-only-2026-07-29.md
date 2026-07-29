# WooCommerce Final Recovery-only — 2026-07-29

## Verified incident

Operation `woo-final-full-e486b03cfe8d` is a terminal failed Sync Run with stale active durable
work. The exact Worker error was Cloudflare `Illegal invocation` caused by an incorrect `this`
receiver for runtime `fetch`; PR #223 corrected that repository wiring and Squash Merged at
`d63317d989f872ff6d5698ad11184683e799d2c8`.

Retained durable evidence:

```text
sync_run_status          failed
sync_run_error_code      WOOCOMMERCE_NETWORK_ERROR
work_lifecycle_status    active
active_lock_count        0
queue_operation_attempts 1
coverage_run_count       0
phase_complete           false
completion               null
Commerce Business rows   0
```

## Recovery decision

Do not run the final one-command launcher while the stale row remains active because that launcher
continues from recovery into Worker rollout and Queue admission. Use a separate exact recovery-only
operator first.

The operator:

- is pinned to `woo-final-full-e486b03cfe8d`;
- requires a distinct recovery-only confirmation;
- reuses the merged failed-work lifecycle contract;
- performs read-only pre/post snapshots;
- mutates exactly one `sync_work_runs` lifecycle row;
- performs no Business, Coverage, phase, unit, generation-fence, Queue, Worker, Lark, Provider,
  Schedule, Secret or Production action.

After recovery, the same operation must be inspected read-only again. Any later Worker deployment
or new full operation remains separately authorized and must preserve automatic safe restore and a
disabled WooCommerce Schedule.
