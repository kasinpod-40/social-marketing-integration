# WooCommerce Report Dimensioned Output v1

Status: `IMPLEMENTED_CI_PENDING`

Branch: `feat/report-commerce-dimensioned-output-v1`

Authority: `docs/tasks/multichannel-report-coverage-v1.md` Phase B

## Objective

Project the bounded WooCommerce Commerce collections already stored in validated
`report_materializations.payload_json` into the existing generic
`MKT_Report_Metric_Values` contract without creating a WooCommerce-only table,
Report engine, Lark view or Dashboard.

## Scope

Repository implementation only:

- retain the existing 13 Commerce summary metrics;
- retain raw `top_products`, `payment_methods`, `shipping_methods` and
  `commerce_context` collections in the D1 materialization;
- normalize collection rankings into generic dimension metric payload rows;
- write summary and dimension rows through the existing Lark materialization writer;
- preserve explicit-null update behavior, observed zero and the locked
  `1 → 3 → 7 → 30` window selector;
- add regression coverage and document the contract.

No Remote D1/Lark read or write, Queue/DLQ action, Worker deployment, Schedule,
Provider request, Production action or Live materialization is authorized here.

## Dimension contract

The writer remains platform-neutral and reads only validated materializations.

| Collection | `dimension_type` | Fixed ranks | Metric |
|---|---|---:|---|
| `top_products` | `product` | 1–5 | `net_sales_micros` |
| `payment_methods` | `payment_method` | 1–20 | `recognized_revenue_micros` |
| `shipping_methods` | `shipping_method` | 1–20 | `recognized_revenue_micros` |

Each row uses:

```text
dimension_value = rank:<n>
rank            = <n>
```

The actual Product/Payment/Shipping identity remains in the validated D1 collection
payload and is represented in `display_name`. The Lark Stable key remains:

```text
report_id
:: escaped(metric_key)
:: escaped(dimension_type)
:: escaped(dimension_value)
```

## Why fixed ranks are required

`TableSyncEngine` is upsert-only and does not delete destination rows. If
`dimension_value` used a changing Product or method ID, a later ranking change would
create a new row while leaving the old row behind.

The implementation therefore emits all 45 bounded ranks on every materialization:

- populated rank: actual numeric value, `client_visible=true`;
- empty rank: numeric fields `null`, `availability_status=not_observed`,
  `client_visible=false`.

The existing explicit-null repository clears stale Lark numeric cells during updates.
Observed numeric zero remains `0` and is never converted to `null`.

## Comparison rule

Collection ranks are not compared to the previous period because rank 1 in the current
period may represent a different entity than rank 1 in the comparison period.

Dimension rows therefore keep:

```text
compare_value  = null
change_value   = null
change_percent = null
```

The existing 13 summary metrics retain their previous-period comparison behavior.

## Row counts

For one WooCommerce report identity:

```text
13 summary metrics
45 dimension metrics
58 total MKT_Report_Metric_Values rows
```

No `MKT_Report_Top_Content` or `MKT_Report_Top_Ads` rows are created for Commerce.

## Settings and schema

- The repository already defines eight WooCommerce settings:
  `1/3/7/9/15/30/90 + Custom`.
- This implementation does not change the settings source.
- The passed Lark Metric writer remains admitted only for rolling
  `1/3/7/30`; 9/15/90 remain fail-closed on this path.
- No D1 migration is required.
- No Lark field, type or option mutation is required.
- `fldMlTUP3Z`, Display V2, Organic Dashboard and Data Quality Dashboard remain unchanged.

Exact Base setting/filter readback remains a separate read-only prerequisite before a
future Live Apply.

## Files

```text
packages/application/src/reports/build-commerce-dimension-metric-payload.js
packages/application/src/reports/build-report-output-rows.js
packages/application/src/use-cases/generate-dashboard-report-materialization.js
packages/application/src/use-cases/write-dashboard-materialization-to-lark.js
tests/application/report-commerce-dimensioned-output.test.js
docs/tasks/woocommerce-report-materialization-v1.md
docs/project-brain/woocommerce-report-materialization.md
```

## Verification required

```text
node --check changed JavaScript
focused Commerce dimension tests
full npm run check
full npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Branch Verification on the exact PR head is the authority because the current connector
environment cannot clone the repository locally.

## Definition of Done

- D1 materialization contains raw Commerce collections and exactly 45 dimension rows.
- Lark planning contains 13 summary plus 45 dimension rows.
- Fixed-rank Stable keys are deterministic and idempotent.
- Empty ranks clear stale numeric values and are hidden from client charts.
- Observed zero remains zero.
- Summary comparison semantics remain unchanged.
- Organic, Ads, Display V2 and locked window behavior regressions pass.
- No Remote or Production action occurs.
