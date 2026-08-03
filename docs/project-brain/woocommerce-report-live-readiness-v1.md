# Project Brain — WooCommerce Report Live Readiness v1

## Readiness architecture

WooCommerce Report rollout now has a mandatory aggregated read-only gate before any Report-only deployment or Queue
admission. The gate returns all reachable blockers and one action per 1D/3D/7D/30D window.

## Permanent integrity rule

A WooCommerce Report identity contains:

```text
13 Commerce summary metrics
45 fixed-rank dimension metrics
--------------------------------
58 total MKT_Report_Metric_Values rows
```

The 45 rank rows are:

```text
Products          5
Payment methods  20
Shipping methods 20
```

Every one of the 58 rows participates in D1/Lark key and value parity. A verifier that checks only summary
`metricPayload` is incomplete.

## Stable identity rule

Dimension rows retain the PR #393 stable row identity:

```text
report_id
+ stableMetricKey
+ dimensionType
+ dimensionValue = rank:<n>
```

The Lark `metric_key` is rank-lossless so generic parity maps do not collapse valid rows. This does not change the
existing `report_metric_key`, dimension type/value or rank contract.

## Null and zero

- Empty ranks remain fixed non-visible placeholders with `current_value=null` and `not_observed`.
- Observed zero remains numeric `0` and client-visible.
- Comparison/change fields remain null for ranked dimensions because equal ranks can represent different entities
  between periods.
- Stale prior numbers must be cleared through the existing explicit-null update repository.

## Locked Lark contract

```text
Table                  MKT_Report_Metric_Values
Canonical window field fldMlTUP3Z
Field name             window_days
Options/order          1 → 3 → 7 → 30
```

Do not recreate or replace the Field. Do not add 9/15/90 to the passed Dashboard selector.

## Audit decisions

- `missing`: create the exact materialization.
- `refresh_legacy_13_to_58`: refresh the existing Stable Report ID with the current formula/output contract.
- `ready_reusable`: keep the Stable Report ID and verify idempotency.
- orphan Lark rows, duplicate `report_metric_key`, active Worker flags, pending migration, open DLQ, active lock, mapping
  drift or window-field drift: block before any mutation.

## Safety

The audit itself uses only Repository reads, Worker status/version reads, Remote D1 SELECT, migration list and Lark
metadata/record reads. It performs zero deployment, Queue action, Provider request, D1/Lark mutation, Schedule change
or Production action.
