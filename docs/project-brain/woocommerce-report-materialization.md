# WooCommerce Report Materialization

Status: `IMPLEMENTED_CI_PASS_REVIEW_REQUIRED`

Authority task: `docs/tasks/woocommerce-report-materialization-v1.md`

Branch: `feat/report-commerce-dimensioned-output-v1`

## Durable decisions

- WooCommerce continues to use the shared `commerce` Report capability.
- The source of truth remains validated `report_materializations`; Lark/Dashboard code
  must not query detailed Commerce facts.
- Existing 13 summary metrics remain unchanged.
- Commerce collection output reuses `MKT_Report_Metric_Values`.
- Dimension types are `product`, `payment_method` and `shipping_method`.
- Ranking identity is fixed `dimension_value=rank:<n>` with numeric `rank`.
- Limits are Product 5, Payment 20 and Shipping 20.
- Each ranking type exposes its primary value:
  Product net sales; Payment/Shipping recognized revenue.
- Current and comparison ranks are not treated as the same entity, so dimension
  compare/change values remain null.
- All 45 ranks are emitted. Empty ranks are non-visible null placeholders that clear
  stale Lark cells through the existing explicit-null update repository.
- Observed zero remains numeric zero.
- One Woo report writes 58 Metric rows: 13 summary + 45 dimension.
- No Woo-only table, Dashboard, View, Report engine or migration is allowed.
- The Lark writer still accepts only rolling windows 1/3/7/30; do not alter
  `fldMlTUP3Z` or its option IDs.
- Exact Base settings/filter verification and Live materialization remain separate,
  explicitly authorized operations.

## Verification

- Branch Verification `#1573` passed on implementation head
  `6699e75e9df65b155738ba159a5e968f121f1c7e`.
- The final documentation-only head must pass Branch Verification again before review closeout.

## Safety

```text
Remote D1                  0
Remote Lark                0
Queue/DLQ                  0
Worker deploy              0
Schedule                   0
Provider                   0
Production                 0
docs/current-task.md edits 0
Meta evidence access       0
```
