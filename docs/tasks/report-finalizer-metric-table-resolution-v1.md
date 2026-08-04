# Report Finalizer Metric Table Resolution v1

## Incident

After PR #484 merged, the Report Finalizer passed Repository gates and stopped safely before migration planning:

```text
stage    report-metric-value-field-migration-preview
code     REPORT_METRIC_FIELD_MIGRATION_FAILED
message  LARK_TABLE_MKT_REPORT_METRIC_VALUES is required
```

No Report materialization, Lark/D1 write, Queue send, Worker active window, Schedule or Production action occurred.

## Root cause

The migration entrypoint admitted the permanent Dashboard Compatibility Freeze before the Report schema stage. The compatibility inspector correctly requires an exact physical Report Metric Values table identity, but the entrypoint supplied only `.dev.vars`/process environment. In the Integration Workspace that table mapping was absent from local environment even though the existing table is resolvable by the shared schema planner from its reviewed name/aliases.

This was an orchestration-order defect, not missing TikTok or multichannel business data:

```text
old order
migration inspector → required env Table ID → schema resolver later

corrected order
shared read-only schema resolver → in-memory Table ID → migration inspector
```

## Correction

- Reuse `planLarkSchema()` and the existing Dashboard Compatibility schema overlay.
- Resolve only `mktReportMetricValues` from existing table identity when the Integration Workspace mapping is absent.
- Add the resolved ID only to the process-local immutable environment object.
- Preserve an explicitly configured mapping without discovery.
- Keep non-Integration profiles on the existing standard path.
- Fail closed when table aliases are ambiguous or unresolved.
- Do not edit `.dev.vars`, `wrangler.sync.jsonc`, Lark schema, Records, D1, Queue, Worker or Schedule.

## Required verification

```text
missing mapping + unique existing table  resolved in memory
configured mapping                       preserved without discovery
non-Integration profile                  unchanged
ambiguous table identity                 blocked
Repository gates                         pass
Report Finalizer live retry              required after merge
```

## Safety

```text
Implementation Remote action  0
Lark mutation                 0
D1 mutation                   0
Queue send                    0
Worker deploy                 0
Schedule                      disabled
Production                    blocked
```
