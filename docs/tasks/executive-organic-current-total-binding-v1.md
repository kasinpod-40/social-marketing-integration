# Executive Organic Current-Total Binding v1

## Incident

The reviewed Integration Workspace Report table contains truthful Organic current-total values while strict rolling-period deltas remain `null` when historical baselines are incomplete. Lark Native Dashboard Statistics renders the empty/null `period_views` result as numeric `0`, which falsely looks like observed zero even though Organic business facts exist.

This is a presentation-binding defect, not a missing-data repair request.

## Existing authority

The merged Organic Dashboard Current Totals & Data Readiness contract already separates Organic metrics into:

```text
period_delta   exact rolling-period delta; null/N/A when baseline is incomplete
current_total  latest observed cumulative state; finite when observed
data_quality   baseline/readiness evidence
```

The Lark Native Dashboard contract requires both `current_total_kpis` and `period_delta_kpis`, preserves null, distinguishes observed zero from unavailable, and expects unavailable metrics to render as N/A rather than fabricated zero.

The later Multichannel Dashboard Compatibility checklist accidentally rebound the Executive headline `Organic Views` Statistic to strict `period_views`. On current Lark Statistics behavior this converts an unavailable period metric into a misleading visible `0`.

## Locked correction

Only the Executive headline Organic view Statistic changes semantics. It becomes the current-total KPI already defined by the shared Organic contract.

### Executive headline

Rename the Statistic label to:

```text
Organic Total Views
```

Use `MKT_Report_Metric_Values` with **Matching: All**:

```text
metric_key          contains    :latest_total_views
metric_scope        is          current_total
availability_status is          available
dimension_type      is          summary
```

Metric:

```text
current_value -> Sum
```

The existing 1D/3D/7D/30D slicer may continue selecting one reviewed materialization window. For a common period end, a current-total metric is expected to remain the same across windows; it must not be interpreted as a period delta.

### Executive window comparison

`Organic Views by Window` remains strict period performance. Use **Matching: All**:

```text
metric_key       contains    period_views
metric_scope     is          period_delta
dimension_type   is          summary
```

Axes:

```text
X = window_days
Y = current_value -> Sum
```

When the reviewed baseline is incomplete, the chart may legitimately show no data. Do not substitute current totals into this by-window chart and do not coerce null to zero.

## Scope boundary

This correction must not:

```text
mutate current_value
rewrite period_views
synthesize historical baseline
rerun reviewed Report windows
change Report IDs
write D1 business facts
send Queue messages
deploy Workers
call Providers
change schedules
change Production
```

No Report materialization repair is authorized by this task.

## Cross-source note

`latest_total_views` is the existing cumulative content-total contract. Account-grain Organic metrics such as `account_views` remain separate metric semantics and must not be silently mixed into this cumulative content-total Statistic. A future cross-source semantic aggregation, if required, must be explicit and must not weaken the strict period-delta contract.

## Acceptance

The correction is complete when:

1. the Executive headline no longer shows a false zero while current-total rows are available;
2. the headline uses only available `current_total` summary rows;
3. the by-window chart remains bound to strict `period_delta` rows;
4. no Report/D1/Queue/Worker/Provider/Schedule/Production mutation is introduced;
5. a fresh Base export proves the intended Dashboard bindings.
