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

## TikTok baseline-only partial Golden Dataset

A live 1D attempt proved a valid Report can be `partial` only because a very small number of Content records lack the comparison-period baseline while current cumulative metrics remain complete. The confirmed evidence was:

```text
tracked content          2024
baseline covered         2021
baseline missing         3
baseline coverage rate   0.9985
current-total metrics    6/6 available
period-delta metrics     6/6 baseline_incomplete
freshness                fresh
```

Controlled Preview readiness therefore admits a narrow baseline-only partial class without relabeling it complete. Admission requires:

- exact TikTok availability/coverage remain `partial`;
- freshness is `fresh` and no critical Data Quality issue exists;
- all six locked current-total metrics are available, observed and numeric;
- all six locked period-delta metrics are `baseline_incomplete`, null and unobserved;
- all five locked Data Quality metrics are available, observed and numeric;
- baseline coverage is at least `0.99` and below `1`;
- tracked, covered and missing counts reconcile exactly;
- reported coverage reconciles to `covered / tracked` within `0.0001`;
- no other unsupported unavailable summary metric exists.

Current-data gaps, stale evidence, coverage below 99%, inconsistent counts or any non-baseline missing metric remain blocked. The resulting TikTok Preview row still reports partial readiness and does not fabricate period deltas or trend recommendations.

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
