# WooCommerce Report Lark-Incomplete Recovery v1

## Status

Repository implementation only. Remote execution remains separately gated after the schema-option dependency is merged and the exact-main Finalizer reaches zero drift. Branch Verification must pass the combined PR #519 plus recovery tree before either Live step is proposed.

## Retained incident

```text
platform                 woocommerce
window                   1D
report identity          retained / unchanged
D1 materialization       1
D1 data status           revisable
Sync Run                 failed
successful Sync Runs     0
Lark Snapshot / Metric   0 / 0
Report DLQ               1 open
active Work / Lock       0 / 0
error code               LARK_PREFLIGHT_FAILED
failed field             dimension_type
rejected value           product
Worker baseline          restored
Chatwoot                 not started
```

The original multiwindow evidence root is non-repeatable.

## Dependency

PR #519 must merge first. Its Finalizer run must append the complete Shared Report dimension option set and return schema zero drift:

```text
summary
product
payment_method
shipping_method
inbox
agent
```

The Inbox/Agent values are included now to prevent Chatwoot from failing at the same Lark preflight later.

## Recovery path

The recovery does not re-enter the Queue and does not deploy a Worker. It reuses the current shared components directly:

```text
existing report_materializations row
→ D1ReportMaterializationReader
→ writeDashboardMaterializationToLark
→ LarkRecordRepository
→ TableSyncEngine
→ exact D1/Lark integrity and Dashboard window parity
→ close only the exact retained Report DLQ metadata
```

Expected Lark result:

```text
Snapshot        1
Metric rows    58
Top Content     0
Top Ads         0
Duplicate keys  0
window_days Number / preserved Dashboard Select parity 58 / 58
```

## Exact gates

- clean current `main == origin/main`;
- retained original Head remains an ancestor;
- current-head Finalizer summary/private environment match;
- Finalizer schema readback actions and conflicts are zero;
- pending D1 migrations are zero;
- exact retained first-send attempt matches Report ID, requested-at and job SHA-256;
- no retained replay attempt or closeout summary exists;
- exactly one failed WooCommerce Dashboard Sync Run matches the Lark option diagnostic;
- exactly one open Report DLQ matches the same payload and diagnostic;
- one unchanged D1 materialization exists with zero successful Sync Runs and zero active lock;
- Lark target is either completely empty or already complete; partial state fails closed;
- `dimension_type` options exactly match the six-value Shared Report contract.

## Mutation boundary

Authorized only during the separately confirmed exact-main recovery:

- create the missing Lark Snapshot/Metric rows through the existing shared writer;
- update only the exact retained DLQ and its operation metadata after parity passes.

Forbidden:

- first-job resend;
- replay send;
- Queue/DLQ generic redrive;
- Worker deployment;
- replacement Report ID;
- Report materialization rewrite;
- Business fact mutation/deletion;
- Provider request;
- Notification Admission, Schedule or Production activation.

## Reviewed command after merge and Finalizer

```bash
CONFIRM_WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY=\
RECOVER_EXACT_WOOCOMMERCE_1D_LARK_INCOMPLETE_REPORT \
MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE=<current-head-finalizer-summary.json> \
node scripts/woocommerce-report-lark-incomplete-recovery.mjs
```

The original failed multiwindow root must not be rerun.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/woocommerce-report-lark-incomplete-recovery.test.js
node --test tests/scripts/woocommerce-report-lark-incomplete-recovery-source.test.js
node --test tests/config/lark-report-schema-v2.test.js
node --test tests/application/report-commerce-dimensioned-output.test.js
node --test tests/application/chatwoot-report-dimension-metrics.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation safety

```text
Remote Lark read/write      0 / 0
Remote D1 read/write        0 / 0
Queue/DLQ action            0 / 0
Worker deployment           0
Provider request            0
Notification Admission      false
Schedule                     false
Production                   BLOCKED
```
