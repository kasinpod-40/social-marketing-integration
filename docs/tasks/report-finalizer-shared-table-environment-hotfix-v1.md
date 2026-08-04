# Report Finalizer Shared Table Environment Hotfix v1

## Incident

After PR #487 merged, the Report Finalizer passed Repository gates and Report Metric migration preview, then stopped safely at `report-schema-preview` because `setup-report-schema.mjs` started a new process with the original environment and required `LARK_TABLE_MKT_REPORT_METRIC_VALUES` again.

No Report materialization, D1/Lark Report write, Queue send, Worker active window, Schedule or Production action occurred.

## Root cause

PR #486 resolved the existing Report Metric Values table only inside the migration entrypoint. That process-local mapping was not reused by the standalone schema entrypoint. Dashboard settings reconciliation also pre-validated only `wrangler.sync.jsonc`, even though the Finalizer passes resolved table mappings through the subprocess environment after schema apply.

## Correction

- make schema preview/apply reuse the existing shared Report Metric Values table resolver before Dashboard Compatibility inspection;
- preserve configured mappings and resolve only a missing Integration Workspace mapping;
- make Dashboard settings preflight use effective table mappings where non-empty subprocess environment values override local Wrangler mappings;
- continue to fail closed when a required table mapping is absent everywhere;
- keep every resolved mapping process-local;
- do not edit `.dev.vars`, `wrangler.sync.jsonc` or Remote resources.

## Verification

- schema setup resolves a missing Integration Workspace Metric table mapping through the shared planner;
- configured Metric mapping remains authoritative;
- Dashboard settings use subprocess table mappings supplied by the Finalizer;
- missing required mappings remain blocked;
- existing compatibility freeze, canonical archive, schema and settings tests remain green;
- full Repository gates required before merge.

## Safety

```text
Implementation Remote action  0
Lark/D1/Queue/Worker           0/0/0/0
Schedule                       disabled
Production                     blocked
```
