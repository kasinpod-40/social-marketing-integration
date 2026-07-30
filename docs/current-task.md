# Current Task — WooCommerce Completed-State Closeout Hotfix v1

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
CURRENT_PROGRAM                     = WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_V1
BASE_MAIN_SHA                       = 05ddfd8f30bdb5ea01d6e604fba501b02413b934
BRANCH                              = hotfix/woocommerce-completed-state-closeout-v1
IMPLEMENTATION_PR                   = #308 / DRAFT / DO_NOT_MERGE
BRANCH_VERIFICATION                 = REQUIRED_ON_FINAL_EXACT_HEAD
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
META_EXECUTION                      = NONE
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

Historical Current Task content before this Workstream is preserved at:

```text
docs/archive/current-task-before-woocommerce-completed-state-closeout-2026-07-31.md
```

## Incident

Exact WooCommerce 2026-only Full operation `woo-final-full-011368480910` reached durable success:

```text
sync_run_status          success
work_lifecycle_status    completed
work_completed_at        1785429797856
phase row                retired
active_lock_count        0
queue_operation_attempts 24
Coverage                 6 / invalid 0
Raw Orders               3433
Raw Order Items          3439
Worker flags             all false
Meta                     not started
Production               blocked
```

The Final verifier failed on a later Remote D1 read. Fresh read-only inspection proved that the
shared Work store had retired `sync_work_phases` after `completeWork()` persisted authoritative
`completion_json`. The existing Final classifier required a retained completed phase, so it could not
admit the valid completed Work. Generic no-active-work discovery would otherwise permit a replacement
Full operation.

## Objective

Close the exact completed durable state without re-running Full reconciliation from zero, without
orphan recovery and without changing existing Business facts:

```text
completed-state admission from completion_json
→ fresh D1 backup
→ D1/Lark parity
→ exact same-operation idempotent replay
→ bounded incremental UAT
→ automatic all-false Safe closeout
→ zero active Work/Lock/Queue operation
```

## In scope

- Pin Full operation `woo-final-full-011368480910` and its original generation/history window.
- Accept retired phase only when Sync Run, Work, `completion_json`, Coverage, generations and failed
  counters prove exact completion.
- Reuse existing Woo job contract, D1 snapshot, D1/Lark parity, Worker config windows, shared Queue
  topology validator and reliability state.
- Send only one same-operation completed-idempotent replay after parity admission.
- Run one separately persisted incremental UAT operation.
- Bind every private checkpoint and Queue-attempt record to the exact Repository Head.
- Persist exact Queue job hash, operation identity, minimum attempt and original Incremental watermark.
- Block blind resend when Queue acceptance exists without a verified stage checkpoint.
- Return Worker to exact all-false state on success and failure.

## Out of scope

- Replacement Full operation.
- Initial Full reconciliation Queue message.
- Orphan-running recovery or lifecycle repair.
- Direct D1/Lark editing, Business deletion or synthetic facts.
- Report 1D/30D, Meta execution, Schedule, Production or customer LIVE UAT.
- Merge or Live execution from this Workstream.

## Completed-state contract

```text
operation_id                  woo-final-full-011368480910
history_start                 2026-01-01T00:00:00.000Z
history_end                   original requested_at / generation
sync_run_status               success
work_lifecycle_status         completed
phase                         retired: complete=false / state=null
Coverage                      6 / invalid 0
failed rows                   0
active Work / Lock            0 / 0
Worker before and after       all false
replacement Full operation    forbidden
```

Store, Orders, Products and Categories may be cross-checked against current Raw totals at initial
admission. Raw Customer/Coupon rows are intentionally excluded because the 2026 cleanup contract
retained older Raw rows. Incremental completion contains delta counters and must not be compared with
current total Raw counts.

## Live entry after Review and Merge

```text
CONFIRM_WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT=\
CLOSE_WOO_FINAL_FULL_011368480910_FROM_COMPLETED_STATE_ONLY \
node scripts/woocommerce-final-completed-state-closeout-launcher.mjs --execute
```

Direct operator execution is not the approved handoff. The launcher resolves the exact Git Head,
places all private evidence under an exact-head directory and sets the required public-entry marker.
The operator uses the Repository's shared Queue topology validator directly.

## Acceptance criteria

```text
Exact completed Full admitted from completion_json     PASS required
Current D1/Lark parity across 14 mappings               PASS required
Same-operation Queue attempt increased                  PASS required
Full completion fingerprint unchanged                   PASS required
Business and Coverage counts unchanged by replay        PASS required
Incremental UAT completed and parity verified            PASS required
Exact-head stage and Queue checkpoints                  PASS required
Accepted Queue evidence without checkpoint              fail closed / no resend
Shared Queue topology validation                        PASS required
Active Work / Lock / Queue operation                    0 / 0 / 0
Worker execution flags                                  all false
Schedule / Production                                   disabled / blocked
Success markers                                         WOOCOMMERCE_2026_COMPLETED_SAFE
                                                        WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
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

## Implementation result

- Added pure completed-state admission, replay comparison, immutable completion fingerprint,
  remote-safe preflight and Lark table binding validation.
- Added guarded closeout operator with clean-current-main enforcement, full local gates, bounded D1
  reads, fresh backup, exact Worker windows, parity, same-operation replay, incremental UAT and
  automatic all-false restore.
- Added stage-aware exact-head checkpoints. Queue acceptance without the corresponding verified Replay
  or Incremental checkpoint stops for review and cannot be resent blindly.
- Persisted the exact Incremental operation, requested-at and original watermark so resumed execution
  cannot silently move the UAT boundary.
- Reused the shared Queue topology validator directly; no closeout-specific compatibility proxy or
  duplicate normalization layer remains.
- Added focused regressions for retired phase admission, retained Raw Customer/Coupon semantics,
  Incremental delta semantics, Source drift, identity/scope/Coverage drift, Replay drift, remote
  preflight, checkpoint safety, exact-head evidence and no replacement Full admission.
- Added detailed contract at `docs/tasks/woocommerce-completed-state-closeout-v1.md`.
- Repository implementation has performed no Remote action.
