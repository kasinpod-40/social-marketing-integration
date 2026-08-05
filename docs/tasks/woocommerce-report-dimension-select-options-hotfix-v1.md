# WooCommerce Report Dimension Select Options Hotfix v1

## Incident

The reviewed WooCommerce 1D Report closeout created exactly one D1 materialization, then the Sync Run failed before any Lark row was written:

```text
platform              woocommerce
window                1D
D1 materialization    1
Lark Snapshot         0
Lark Metric           0
Sync status           failed
error code            LARK_PREFLIGHT_FAILED
failed field          dimension_type
rejected value        product
new Report DLQ        1 open
active Work / Lock    0 / 0
Worker baseline       restored
Chatwoot              not started
```

The exact Report identity and first-send attempt are retained. Blind first-job resend, generic DLQ redrive and replacement Report identity are forbidden.

## Root cause

PR #393 added 45 fixed-rank Commerce dimension rows using these generic values:

```text
summary
product
payment_method
shipping_method
```

The shared writer and Stable-key contract were updated, but the executable Lark Report schema still inherited only `summary` from the original `dimension_type` SingleSelect field. The earlier task incorrectly stated that no Lark option extension was required.

This is a shared schema-authority omission, not a WooCommerce source, D1 materialization, Queue identity or Dashboard-window defect.

## Correction

- declare the complete Report Metric dimension option contract in `lark-report-materialization-schema.js`;
- bump the additive materialization schema contract to v5;
- extend only `MKT_Report_Metric_Values.dimension_type` through the existing executable Lark schema overlay;
- preserve the existing `summary` option and its Option ID;
- append `product`, `payment_method` and `shipping_method` additively;
- add cross-contract regression proving the materialization and executable schema options remain identical;
- do not create a Woo-specific field, table, schema engine or writer.

## Post-merge recovery boundary

1. synchronize exact clean merged `main`;
2. rerun the existing Report Runtime Finalizer so schema Preview/Apply appends only the three missing Select options and reaches zero drift;
3. inspect and bind the exact WooCommerce 1D failed Sync Run and open DLQ;
4. run an incident-bound continuation that reuses the existing D1 materialization and writes its exact rows to Lark without creating a replacement Report identity;
5. close only the exact retained DLQ after D1/Lark integrity and Notification baseline restore pass;
6. resume WooCommerce 3D/7D/30D, then Chatwoot.

The original WooCommerce first-send root must never be rerun.

## Safety

```text
Repository implementation Remote action  0
Remote Lark/D1 mutation                0 / 0
Queue/DLQ action                       0 / 0
Worker deployment                      0
Provider request                       0
Notification Admission                 false
Schedule                               false
Production                             BLOCKED
```

## Required verification

```bash
npm ci
npm run check
node --test tests/config/lark-report-schema-v2.test.js
node --test tests/application/report-commerce-dimensioned-output.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
