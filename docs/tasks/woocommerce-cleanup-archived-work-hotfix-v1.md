# WooCommerce Cleanup Archived Work Hotfix v1

## Incident

The canonical WooCommerce 2026 completion verified that pre-2026 D1/Lark cleanup was complete, then stopped before Final rollout with:

```text
WOOCOMMERCE_2026_COMPLETION_CLEANUP_STATE_INVALID
activeWork=0
replacedActiveWork=0
otherActiveWork=0
activeLocks=0
workStatus=null
syncStatus=failed
syncErrorCode=WOOCOMMERCE_HISTORY_SCOPE_REPLACED
oldRows=0
aggregateRows=0
```

Meta Finalizer did not start. The failed attempt did not admit a new WooCommerce operation.

## Confirmed Repository defect

The completion validator recognized only a retained terminal `sync_work_runs` row as completed cleanup. Live state retained the exact scope-replaced `sync_runs` closure while the corresponding terminal Work row was no longer present. The validator therefore rejected an otherwise exact completed state.

The cause of Work-row archival/removal is not inferred by this hotfix. The correction is limited to recognizing the observed state without weakening any business or reliability gate.

## Correction contract

Completed cleanup is accepted only when all of the following are true:

```text
replaced active work             0
active work                      equals other active work
active locks                     0
replaced Work status             terminal OR absent/null
replaced Sync status             failed
replaced Sync error code         WOOCOMMERCE_HISTORY_SCOPE_REPLACED
pre-2026 target rows             0
```

A missing Work row is classified as `replacedWorkArchived=true`. A retained terminal Work row remains classified as `replacedWorkRetained=true`.

The validator still rejects:

- active or foreign Work outside the existing exact-resume allowance;
- active locks;
- any remaining pre-2026 target rows;
- missing or different Sync closure;
- non-terminal, non-null Work status;
- ambiguous post-cleanup state.

## Resume safety

The next canonical completion run must verify and skip cleanup, then continue through the existing Final reconciliation, D1/Lark parity, exact replay, incremental UAT and all-false closeout. Meta remains blocked until WooCommerce completion returns zero active Work/Lock/Queue operations and all Worker/Schedule flags are false.

## Required validation

```text
Focused archived-work cleanup tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI
```

## Safety

Repository implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue/DLQ send, Provider request, Schedule change, Meta execution, Secret change or Production action.
