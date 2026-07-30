# WooCommerce Orphaned-running Recovery v1

## Incident

Manifest-gated Final execution admitted exactly one 2026-only Full operation:

```text
operation_id             woo-final-full-011368480910
requested_at/generation  1785405597071
history_start             2026-01-01T00:00:00.000Z
history_end               operation requested_at
```

The operation made valid partial progress and the original local verifier stopped at its old
20-minute bound. Automatic Worker Safe restore then returned every execution flag to false.
The Queue delivered one later attempt, but the durable state remained unchanged without a live lock:

```text
sync_run_status          running
work_lifecycle_status    active
active_lock_count        0
queue_operation_attempts 7
dataset_index/page       1 / 10
source_rows              901
D1 rows                  4501
derived rows             1203
Lark writes              3904
failed rows              0
raw Orders               1000
raw Order Items          1001
Coverage                 2 / invalid 1
```

Repeated read-only observation showed no cursor, count, Queue, Coverage or Business-row progress.
Meta was not started. Production and Schedule remained blocked.

## Root cause decision

This is an orphaned Sync Run, not a completed operation and not a permanent Business-data failure:

- `sync_runs.status` remained `running` after the execution context disappeared;
- the exact durable Work and incomplete phase still contain the continuation cursor;
- no active lock exists;
- partial D1/Lark facts are valid and must be retained;
- the Final exact-continuation selector requires a failed retryable Sync Run while Work remains active.

Terminalizing `sync_work_runs`, deleting partial facts or admitting a replacement Full operation would
break the existing continuation contract. Recovery therefore changes only the exact Sync Run state.

## Exact recovery contract

Target identity is immutable:

```text
operation_id   woo-final-full-011368480910
work_key       woocommerce:woo-final-full-011368480910
generation     1785405597071
customer       chemistry_k
environment    development / integration_workspace
```

Before mutation the operator performs two Remote D1 SELECTs separated by 30 seconds. Both reads must
match the same sanitized stability fingerprint and all exact incident guards:

- Sync Run `running`, unfinished, no error/retryability classification;
- durable Work `active`, incomplete and without terminal metadata;
- one active Work globally, zero other active Work and zero live locks;
- one Queue-operation row, attempt count exactly `7`, matching generation/original requested-at;
- one phase and one generation fence with the exact cursor/scope/state;
- Coverage exactly `2`, invalid Coverage exactly `1`;
- exact 14 Commerce table counts and exact durable state counters;
- zero changes during the 30-second stability window.

Any drift fails closed before mutation.

## Mutation allowlist

One un-retried guarded `UPDATE sync_runs` is allowed for the exact Sync Run only:

```text
status         running -> failed
finished_at    set once
error_code     WOOCOMMERCE_D1_READ_FAILED
retryable      true in details_json
true cause     WOOCOMMERCE_ORPHANED_EXECUTION
recovery mode  exact_durable_continuation
audit ref      repository-head-bound
updated_at     current time
```

`WOOCOMMERCE_D1_READ_FAILED` is the existing compatibility class accepted by the reviewed exact
continuation selector. The operator does not claim that a new D1 read failed; the true incident cause
is stored independently as `WOOCOMMERCE_ORPHANED_EXECUTION`.

The mutation repeats every race-sensitive guard from the second read. It must report exactly one
changed row. It must not update:

- `sync_work_runs`, phase rows, work units or generation fences;
- Queue-operation attempts or DLQ evidence;
- Coverage rows;
- WooCommerce Raw, Canonical, Daily or aggregate Business facts;
- Lark records;
- Worker configuration/deployment, Preview, Secrets or Schedule.

## Post-verification

A fresh SELECT must prove:

- Sync Run is failed/retryable with the exact cause and audit reference;
- durable Work is still active and incomplete;
- the durable fingerprint across Work/Phase/Fence/Queue/Coverage/Business facts is unchanged;
- lock remains zero and no foreign active Work appeared.

Success marker:

```text
ORPHANED_SYNC_MARKED_RETRYABLE
```

## Continuation after recovery

After this hotfix is merged and the exact recovery succeeds, the existing canonical WooCommerce 2026
completion must resume `woo-final-full-011368480910` only. It may send the next exact Queue attempt
for that identity and use the existing durable phase cursor. A replacement Full operation remains
forbidden.

Woo must then pass:

```text
full reconciliation completion
D1/Lark parity
same-operation replay
incremental UAT
all-false Safe closeout
zero active Work / Lock / Queue operation
```

Meta remains blocked until Woo produces `WOOCOMMERCE_2026_COMPLETED_SAFE`.

## Safety

```text
Remote action during Repository implementation  none
Sync Run mutation during Live recovery           exactly 1 guarded row
Durable Work mutation                            0
Business/Coverage/Lark mutation                  0
Queue message during recovery                    0
Worker deploy during recovery                    0
Schedule                                         disabled
Production                                       blocked
```

## Required validation

```text
Focused orphaned-running recovery tests
Exact-continuation regressions
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI on exact Head
```
