# WooCommerce Report Live Readiness Audit v1

## Status

```text
TASK_STATUS                 = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BRANCH                      = audit/woocommerce-report-live-readiness-v1
BASE_MAIN                   = f212c5110573ef0af5012e8385d6ee25e67041cd
MODE                        = READ_ONLY_AGGREGATED_AUDIT
REMOTE_MUTATION_COUNT       = 0
SCHEDULE                    = DISABLED
PRODUCTION                  = BLOCKED
```

## Objective

Collect every reachable blocker before WooCommerce Report materialization instead of discovering one prerequisite per
Live attempt. The operator reads Repository, finalizer evidence, Worker bindings, Remote D1, Lark schema and the
1D/3D/7D/30D materialization state, then emits one sanitized decision and exact per-window actions.

## Historical baseline reused

- WooCommerce source ingestion, 2026 reconciliation, D1/Lark parity and incremental recovery are already closed.
- Shared Report runtime, D1 Commerce adapter, Lark writer and guarded report-only Worker window already exist.
- PR #393 added 45 fixed-rank dimension rows to the 13 Commerce summary rows: 58 rows per Report identity.
- `MKT_Report_Metric_Values.window_days` must preserve Field ID `fldMlTUP3Z` and option order `1 → 3 → 7 → 30`.
- 9/15/90 remain fail-closed for the current Lark metric writer.

## Regression found before Live

The existing closeout integrity path keyed Lark values only by `metric_key`. PR #393 intentionally emitted repeated
Product/Payment/Shipping metric keys across ranks, so valid dimension rows would be classified as duplicates. The
same verifier compared only `payload.metricPayload` and therefore validated 13 summary rows rather than all 58 rows.

The correction:

1. gives each rank a lossless `metricKey`;
2. preserves the original PR #393 `report_metric_key` through `stableMetricKey + dimensionType + dimensionValue`;
3. verifies all 13 summary and 45 dimension values at Lark Number precision;
4. detects missing/stale/null/zero drift for any rank;
5. keeps empty-rank null placeholders and observed zero semantics unchanged.

## Read-only operator

```bash
CONFIRM_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT=\
RUN_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT \
node scripts/woocommerce-report-live-readiness-audit.mjs --execute
```

Default invocation is plan-only.

The executable audit performs only:

- Git fetch/status/revision reads;
- local finalizer-evidence and config reads;
- Worker deployment status/version reads;
- Remote D1 SELECT statements;
- Remote migration-list reads;
- Lark table/field/record reads;
- private sanitized evidence write below ignored `outputs/`.

It contains no Worker deployment, Queue send, D1 export/write, Lark mutation, Provider request, Schedule action or
Production path.

## Aggregated gates

### Repository and finalizer

- clean current `main == origin/main`;
- valid `report_runtime_finalize_v1` evidence on the exact current Head;
- zero finalizer schema/settings drift;
- 66 canonical Report settings and zero active Legacy settings.

### Config and Worker

- Safe config has zero true execution flags;
- reviewed Active config has exactly three Report flags;
- current Remote Worker is all-false;
- D1, Queue and Report Lark mappings match the reviewed config;
- one Worker version owns 100% traffic.

### D1

- latest WooCommerce Orders Coverage is complete/partial/revisable/no-data-confirmed with an approved scope mode;
- Commerce Daily and Order state facts are non-empty;
- zero active Report lock;
- zero open Report DLQ;
- zero pending migration.

### Lark

- all required Report/Sync/Alert tables exist;
- Stable-key fields exist;
- `fldMlTUP3Z` remains canonical `window_days`;
- exact options are `1`, `3`, `7`, `30` in that order with unique option IDs.

### Per-window classification

```text
missing D1 + missing Lark             create_materialization
13-row legacy materialization         refresh_legacy_13_to_58
58 rows + exact D1/Lark parity        reuse_or_idempotent_verify
orphan Lark / duplicate Stable key    BLOCKED
other payload/value drift             refresh_or_repair_materialization
```

## Files

```text
packages/application/src/reports/build-commerce-dimension-metric-payload.js
packages/application/src/reports/build-report-output-rows.js
scripts/lib/report-runtime-window-repair.js
scripts/lib/woocommerce-report-live-readiness-audit.js
scripts/woocommerce-report-live-readiness-audit.mjs
tests/application/report-commerce-dimensioned-output.test.js (existing regression preserved)
tests/scripts/woocommerce-report-metric-integrity.test.js
tests/scripts/woocommerce-report-live-readiness-audit.test.js
tests/scripts/woocommerce-report-live-readiness-audit-source.test.js
docs/tasks/woocommerce-report-live-readiness-v1.md
docs/project-brain/woocommerce-report-live-readiness-v1.md
```

`docs/current-task.md` remains owned by the Chatwoot closeout/Meta handoff workstream and is unchanged.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/report-commerce-dimensioned-output.test.js
node --test tests/scripts/woocommerce-report-metric-integrity.test.js
node --test tests/scripts/woocommerce-report-live-readiness-audit.test.js
node --test tests/scripts/woocommerce-report-live-readiness-audit-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository verification must execute zero Live or Remote mutation.
