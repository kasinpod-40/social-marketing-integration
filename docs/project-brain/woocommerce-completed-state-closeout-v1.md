# Project Brain — WooCommerce Completed-State Closeout v1

## Verified live boundary

```text
operation_id             woo-final-full-011368480910
sync_run_status          success
work_lifecycle_status    completed
work_completed_at        1785429797856
phase row                retired after completeWork
active_lock_count        0
queue_operation_attempts 24
Coverage                 6 / invalid 0
Raw Orders               3433
Raw Order Items          3439
Worker flags             all false
Meta                     not started
Production               blocked
```

The exact 2026 Full ingestion is complete. The failed local command was a verifier/read failure after
durable completion, not a failed Provider/D1/Lark ingestion. `completion_json` is authoritative after
the resumable Work store retires the phase row.

## Permanent decision

- Never run orphan recovery again for this operation.
- Never admit a replacement Full operation.
- Never delete or manually repair the 3,433 Orders or related Business facts.
- Do not treat `phaseComplete=false` plus `state=null` as incomplete when exact successful Sync/Work,
  immutable completion reconciliation, generations, Coverage and zero failures prove normal phase
  retirement.
- Raw Customer and Coupon rows may include intentionally retained pre-2026 Raw history and must not be
  compared with bounded 2026 completion Source counts.
- Incremental completion counters are deltas and must not be compared with current total Raw counts.
- Live execution must use `woocommerce-final-completed-state-closeout-launcher.mjs`; direct operator
  invocation is not the approved handoff.
- Private evidence is exact-head scoped. Queue-attempt records must match the exact job hash,
  operation, minimum attempt and Repository Head.
- An accepted Queue message without the corresponding verified stage checkpoint is review-required;
  it is never authorized for blind resend.

## Closeout path

```text
completed-state admission from completion_json
→ fresh D1 backup
→ D1/Lark parity
→ exact same-operation completed-idempotent replay
→ bounded incremental UAT
→ all-false Safe closeout
→ zero active Work / Lock / Queue operation
```

The initial completed Full operation is not resent. The only Full Queue action is the same-operation
idempotent replay after parity admission. A separately persisted operation identity and immutable
watermark are used for Incremental UAT.

The launcher resolves the exact Git Head and binds the evidence directory to it. The operator uses the
shared Woo Queue topology validator directly for modern/legacy fields and DLQ identity; no separate
closeout compatibility proxy is allowed.

## Success markers

```text
WooCommerce=WOOCOMMERCE_2026_COMPLETED_SAFE
ExactCompletedStateCloseout=true
WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
```

Meta and Report 1D/30D Live execution remain blocked until these markers are observed and Worker
all-false plus zero active reliability state are freshly verified.

## Repository authority

```text
docs/current-task.md
docs/tasks/woocommerce-completed-state-closeout-v1.md
scripts/lib/woocommerce-final-completed-state-closeout.js
scripts/woocommerce-final-completed-state-closeout.mjs
scripts/woocommerce-final-completed-state-closeout-launcher.mjs
tests/application/woocommerce-final-completed-state-closeout.test.js
tests/application/woocommerce-final-completed-state-launcher.test.js
tests/application/woocommerce-final-completed-state-checkpoint-source.test.js
PR #308
```
