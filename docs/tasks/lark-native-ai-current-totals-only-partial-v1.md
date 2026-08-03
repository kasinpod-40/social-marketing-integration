# Lark Native AI Current-Totals-Only Partial v1

## Incident

The exact-terminal Controlled Preview read all four validated TikTok Report windows and stopped safely before Lark write. The retained evidence proved two distinct partial classes:

```text
1D   baseline coverage 0.9985  current totals 6/6  new content 0
3D   baseline coverage 0.9990  current totals 6/6  new content 1
7D   baseline coverage 0.0015  current totals 6/6  new content 3
30D  baseline coverage 0.0128  current totals 6/6  new content 26
```

All four windows were fresh. Every Period-delta metric was explicitly `baseline_incomplete`, null and unobserved. The current cumulative totals and five Data Quality metrics remained available and observed. No Lark Record write, AI call, D1, Queue, Worker, Provider, notification, Schedule or Production action occurred.

## Root cause

The first hotfix admitted only partial evidence with at least 99% baseline coverage. That is correct for the 1D and 3D windows but conflated two separate questions:

1. Is the current cumulative TikTok evidence safe to display in a controlled Preview?
2. Is comparison-period evidence complete enough to calculate Period deltas and trends?

The 7D and 30D evidence answers `yes` to the first question and `no` to the second. Blocking the entire Preview hid valid current totals; relabeling the Report complete or calculating Period deltas would fabricate comparison readiness.

## Admission classes

### `complete`

```text
previewEligible         true
currentTotalsReady      true
comparisonReady         true
periodDeltasSuppressed  false
```

### `baseline_partial_high_coverage`

For baseline coverage at least 99% and below 100%:

```text
previewEligible         true
currentTotalsReady      true
comparisonReady         false
periodDeltasSuppressed  true
```

### `current_totals_only_low_baseline`

For baseline coverage above zero and below 99%, admission additionally requires:

- the selected window contains at least one new Content record;
- at least one Content record has baseline coverage;
- all six locked current-total metrics are available, observed and numeric;
- all six locked Period-delta metrics are `baseline_incomplete`, null and unobserved;
- all five locked Data Quality metrics are available, observed and numeric;
- tracked Content equals covered plus missing Content;
- missing Content is greater than zero;
- reported coverage reconciles to covered/tracked within `0.0001`;
- evidence is fresh and has no critical Data Quality issue;
- no unsupported unavailable summary metric exists.

The visible Lark row remains:

```text
data_status       partial
readiness_status  report_partial
generation_status pending
coverage_rate     null
```

Current totals remain present. Period deltas remain null. Comparison and trend readiness remain false.

## Blocked cases

The Golden Dataset remains blocked when any of these conditions is present:

- stale evidence;
- a current-total metric is unavailable or non-numeric;
- a Period-delta metric contains a fabricated value;
- a required Data Quality metric is missing;
- tracked/covered/missing counters do not reconcile;
- coverage is zero;
- low-baseline evidence has no new Content in the selected window;
- low-baseline evidence has zero covered Content;
- a critical Data Quality issue exists;
- another unavailable summary metric is introduced outside the locked Period-delta set.

## All-window terminal diagnostics

The exact-terminal readiness stage now evaluates `1D / 3D / 7D / 30D` completely before failing. A blocked run reports:

```text
blockedWindowCount
blockedWindows[]
windowResults[1D,3D,7D,30D]
goldenDatasetAuthority per window
```

This prevents repeated one-window-at-a-time diagnosis. The stage still stops before the Live Pilot child and before any Lark Record write.

## Scope and safety

- No Report materialization is modified.
- No retained Live evidence is edited or relabeled.
- No partial Report becomes complete.
- No Period delta, trend or recommendation is fabricated.
- Existing 40-row create/update limit, zero-delete rule and same-input replay remain unchanged.
- `docs/current-task.md` remains owned by the Chatwoot workstream and is not modified.
- Repository implementation and CI perform zero Live or Remote action.
