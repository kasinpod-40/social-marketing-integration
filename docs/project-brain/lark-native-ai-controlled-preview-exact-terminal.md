# Project Brain — Lark Native AI Controlled Preview Exact Terminal

## Purpose

The exact-terminal workstream converts the merged Controlled Preview stack into one reviewed user command. It removes shell heredoc, manual SHA, manual approval JSON, manually assembled readiness input and any pre-created retained source file.

## Current authority chain

```text
current clean main
→ local all-blocker preflight
→ read-only live Lark schema and Report output collection
→ exact TikTok 1D/3D/7D/30D source selection
→ generated retained real-data source package
→ package checksum and exact-main binding
→ schema zero-drift / View 6/6 authority
→ explicit sequential Lark-only handoff authority
→ deterministic 1D/3D/7D/30D readiness plans
→ existing 40-row Executor planner
→ existing bounded Lark Live Pilot
→ independent same-input replay
```

The exact Terminal does not create a second Report materializer, Lark client or execution planner. It reuses the existing Lark client, schema inventory/view-filter authorities, offline bundle/readiness builder, Executor planner and Live Pilot writer.

## Real-data boundary

The first exact-terminal proof admits business metrics only from the validated TikTok Organic Report rows already present in:

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
```

For each exact window `1/3/7/30`, the collector selects one unique latest Report snapshot, requires it to be no older than seven days, and reads Metric rows only for its exact `report_id`.

All other business channels remain visible as status-only rows. Their missing/pending state is not converted to zero and no unaligned historical Report is reused.

## TikTok partial Golden Dataset classes

Live exact-terminal evidence proved that Preview eligibility and comparison readiness are different authorities.

### High-coverage baseline partial

The confirmed 1D/3D class keeps the Report partial while admitting current totals when baseline coverage is at least `0.99` and below `1`.

### Current-totals-only low baseline

The confirmed 7D/30D class has fresh current cumulative totals and reconciled Data Quality counters but too little comparison baseline for Period deltas:

```text
7D   tracked 2024  covered 3   missing 2021  coverage 0.0015  new content 3
30D  tracked 2024  covered 26  missing 1998  coverage 0.0128  new content 26
```

Controlled Preview admits this class only when:

- availability and coverage remain `partial`;
- freshness is `fresh` and no critical Data Quality issue exists;
- all six locked current-total metrics are available, observed and numeric;
- all six locked Period-delta metrics are `baseline_incomplete`, null and unobserved;
- all five locked Data Quality metrics are available, observed and numeric;
- tracked equals covered plus missing, and missing is greater than zero;
- reported coverage reconciles to covered/tracked within `0.0001`;
- coverage is above zero and below `0.99`;
- the selected window has at least one new Content record and at least one covered Content record;
- no unsupported unavailable summary metric exists.

The authority is retained on every readiness plan:

```text
admissionClass          complete | baseline_partial_high_coverage | current_totals_only_low_baseline
previewEligible         true/false
currentTotalsReady      true/false
comparisonReady         true/false
periodDeltasSuppressed  true/false
baselineCoverageRate
tracked/covered/missing/new Content counts
```

Neither partial class is relabeled complete. Current totals remain visible, Period deltas remain null, comparison readiness remains false and trend recommendations must not be inferred from missing baseline evidence.

Current-data gaps, stale evidence, zero coverage, inconsistent counts, low-baseline windows with no new Content or any non-baseline missing metric remain blocked.

## All-window readiness diagnostics

The exact Terminal evaluates all four retained Offline inputs before returning a readiness failure. A single stopped attempt reports every blocked window and the Golden Dataset authority for all `1D/3D/7D/30D` windows instead of exposing one blocker per rerun.

The aggregated diagnostic still occurs before the Live Pilot child and before any Lark Record write.

## Sequential Terminal rule

The user runs this command only after the preceding Meta or Chatwoot Terminal command has ended; the commands are not run simultaneously. PR closure is not used as the runtime mutex.

The exact Terminal records this as:

```text
authorityMode=isolated_lark_ai_table_only
source=explicit_sequential_lark_only_handoff
operatorSequentialConfirmation=true
observedRemoteWorker=false
mutationSurface=lark_mkt_ai_report_runs_records_only
```

This authority is valid only because the exact Terminal:

- requires every local Integration Workspace execution flag false;
- acquires an exclusive local lock;
- reads Report/schema metadata through a read-only allowlist;
- writes only Preview Records in `🧠 MKT_AI_Report_Runs`;
- performs no Worker, D1, Queue, Provider, Schedule or Production action.

It does not claim to have remotely observed or changed the Worker deployment.

## Source collector boundary

Allowed source requests:

```text
tenant token
List Tables
List AI Fields
List/Get six AI Views
Search Report Snapshots by four TikTok setting keys
Search Report Metrics by four selected report IDs
```

Any other method/path is blocked before fetch. The collector cannot create, update or delete a Record.

## Fixed write-child boundary

The parent overrides local retry/pagination settings with:

```text
maxAttempts=1
maxPages=1
maxFilterConditions=50
requestTimeoutMs=30000
minRequestIntervalMs=150
```

Partial or unknown write outcomes are never automatically retried. Every new explicit attempt starts by searching Stable keys.

## Success contract

First pass:

```text
0..40 bounded create/update writes
fresh zero-drift verification
```

Independent replay:

```text
40 no_op
0 writes
0 deletes
```

AI, Automation, notification, D1, Queue, Worker deployment, Provider, Schedule and Production actions remain zero/disabled/blocked.

## Evidence retention

Every run receives a new private attempt directory. The automatically collected source package, generated Live Pilot input and both child results use mode `0600`; directories use mode `0700`; files are never overwritten.

A local exclusive lock prevents two exact-terminal processes from running concurrently. A pre-existing lock is never removed automatically because an earlier process may still be active or require evidence inspection.
