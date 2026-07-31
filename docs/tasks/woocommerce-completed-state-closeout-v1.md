# WooCommerce Completed-State Closeout Hotfix v1

## Incident

Exact 2026-only Full operation:

```text
operation_id             woo-final-full-011368480910
sync_run_status          success
work_lifecycle_status    completed
work_completed_at        1785429797856
phase row                retired after completed Work
active_lock_count        0
queue_operation_attempts 24
Coverage                 6 / invalid 0
Raw Orders               3433
Raw Order Items          3439
Worker flags             all false
Meta                     not started
Production               blocked
```

The local Final verifier failed while reading Remote D1 after the durable operation had already
completed. Automatic all-false Safe restore succeeded. A fresh read-only inspector then observed a
successful Sync Run and completed durable Work, but `phaseComplete=false` and `state=null` because the
shared resumable Work store retires the phase row after `completeWork()` persists the authoritative
`completion_json` reconciliation.

The previous Final classifier only accepted a retained completed phase with `datasetIndex=6`. It
therefore classified the valid completed Work as incomplete and the generic completion discovery
would return no active Work, allowing the old path to create a replacement Full operation.

## Root-cause decision

This is a Final closeout admission defect, not a failed WooCommerce ingestion:

- `sync_runs` and `sync_work_runs` prove exact successful completion;
- `completion_json` contains immutable reconciliation identity, generation, 2026 Source scope,
  six dataset counters, total counters and zero failed rows;
- Coverage is exactly six valid datasets;
- no active Work or Lock remains;
- the phase row was retired as part of normal durable completion;
- the current Worker is all-false;
- all 3,433 Orders and related Business facts must be retained.

No lifecycle repair, orphan recovery, replacement Full operation, Business delete or manual D1/Lark
edit is authorized.

## Correction architecture

A dedicated completed-state closeout operator is added instead of weakening the generic active-resume
selector or duplicating the Woo ingestion engine:

```text
clean current main + full local gates
→ Worker all-false / zero active Work-Lock / zero pre-2026 rows
→ exact completed-state admission from completion_json
→ fresh D1 backup
→ reviewed Woo manual-UAT Worker window
→ current D1/Lark parity
→ one same-operation completed-idempotent replay
→ bounded incremental UAT
→ automatic all-false Safe closeout
→ zero active reliability state + immutable Full completion verification
```

The initial completed Full operation is not sent again as a reconciliation operation. The only Full
Queue message is the required same-operation idempotent replay after the completed state and D1/Lark
parity are already admitted.

## Exact completed-state admission

The Full operation is pinned to:

```text
operation_id  woo-final-full-011368480910
work_key      woocommerce:woo-final-full-011368480910
history_start 2026-01-01T00:00:00.000Z
history_end   original requested_at / generation
scope_mode    report_range
```

Admission requires:

- Sync Run `success`, finished, no error;
- Work `completed`, completed timestamp present;
- phase retired (`phaseComplete=false`, `state=null`);
- Queue, Work and completion generations equal original requested-at;
- exact reconciliation schema/work key/source scope;
- exact six dataset keys;
- Full expected/source rows equal per dataset;
- total and dataset failed rows equal zero;
- Coverage `6`, invalid Coverage `0`;
- active lock `0`;
- at least one Queue attempt.

At initial admission, Store, Orders, Products and Categories Source counters are cross-checked with
current Raw D1 counts. Raw Customer and Coupon rows are excluded from that comparison because the
2026 cleanup contract intentionally retained older Raw Customer/Coupon rows. Incremental completion
uses delta counters and is never compared with current total Raw counts.

## Replay, Incremental and checkpoint safety

Same-operation replay must:

- use the exact existing Full operation/generation/history window;
- observe Queue attempts increasing by at least one;
- preserve all 14 D1 Business table counts;
- preserve Coverage counts;
- preserve the immutable completion fingerprint;
- pass fresh D1/Lark parity.

Incremental UAT uses a separately persisted exact operation identity, requested-at and original
watermark. Final verification allows current Business counts to move after Incremental while still
requiring the original Full completion fingerprint to remain unchanged.

All private evidence is nested under the exact Repository Head. Replay and Incremental stage
checkpoints record the exact Head, operation, minimum Queue attempt and completion fingerprint. Queue
attempt evidence additionally records the stable job SHA-256. Any evidence drift fails closed.

A Queue request recorded before HTTP acceptance is uncertain and cannot be resent. A confirmed Queue
acceptance without the corresponding verified stage checkpoint also cannot be resent; the operator
returns `WOOCOMMERCE_COMPLETED_STATE_QUEUE_ACCEPTED_REVIEW_REQUIRED` for read-only incident review.

## Shared Queue topology

The closeout operator calls the Repository's existing `assertWooCommerceQueueConsumerTopology`
directly. That shared contract already validates current and legacy Cloudflare fields, whole-second
wait conversion, alias conflicts and DLQ identity. No closeout-specific proxy or duplicate topology
normalizer is retained.

## Mutation allowlist

```text
Fresh D1 backup                       1
Worker UAT deployment                 1
Exact Full idempotent replay message  1
Incremental UAT message               1
Worker all-false closeout deployment  1
Direct D1 mutation                    0
Direct Lark mutation                  0
Business-fact delete                  0
Work/Sync/Phase repair                0
Orphan recovery                       0
Replacement Full operation            0
Blind Queue resend                    0
Meta execution                        0
Schedule / Production                 blocked
```

Automatic all-false restore runs after every failure once a mutable Worker window is owned.

## Approved Live entry after Review and Merge

```text
CONFIRM_WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT=\
CLOSE_WOO_FINAL_FULL_011368480910_FROM_COMPLETED_STATE_ONLY \
node scripts/woocommerce-final-completed-state-closeout-launcher.mjs --execute
```

The launcher binds evidence to the exact Git Head and sets the required public-entry marker. Direct
operator execution fails closed.

## Success markers

```text
WooCommerce=WOOCOMMERCE_2026_COMPLETED_SAFE
ExactCompletedStateCloseout=true
WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
```

Meta remains blocked until these markers and final zero-active/all-false verification are present.

## Repository files

```text
scripts/lib/woocommerce-final-completed-state-closeout.js
scripts/woocommerce-final-completed-state-closeout.mjs
scripts/woocommerce-final-completed-state-closeout-launcher.mjs
tests/application/woocommerce-final-completed-state-closeout.test.js
tests/application/woocommerce-final-completed-state-launcher.test.js
tests/application/woocommerce-final-completed-state-checkpoint-source.test.js
docs/tasks/woocommerce-completed-state-closeout-v1.md
```

## Required validation

```text
npm ci
npm run check
focused completed-state / Final / runtime / checkpoint tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

Repository implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue send,
Provider request, Schedule/Secret change, Meta execution or Production action. Live execution remains
blocked until Review, exact-head CI and Merge are complete.
