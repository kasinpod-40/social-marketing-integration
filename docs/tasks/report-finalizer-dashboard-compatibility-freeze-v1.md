# Report Finalizer Dashboard Compatibility Freeze v1

## Incident

The Report Finalizer passed all Repository gates on clean `main@d3684228032fa64f72a68a91f999b41f3c6e547c` and stopped safely during the Report Metric migration preview with two blockers:

```text
display_name  REPORT_METRIC_FIELD_MIGRATION_CANONICAL_WITHOUT_SOURCE
window_days   REPORT_METRIC_FIELD_MIGRATION_WINDOW_OWNERSHIP_NOT_CONVERGED
records       86
```

No Report materialization, Lark/D1 write, Queue send, Worker active window, Schedule or Production action started.

## Root cause

The Finalizer still evaluated the historical Field-promotion target even though the Repository permanently retired that path after Lark rejected Dashboard Block PATCH operations.

The current Integration Workspace authority is the merged Dashboard Compatibility Freeze:

```text
display_name                     Text canonical authority
window_days                      Number planning/write authority
__mkt_legacy_window_days...v1    preserved Dashboard SingleSelect mirror
Legacy display v1/v2             immutable Dashboard compatibility archives
```

Dashboard PATCH, Field rename/delete and Legacy cleanup remain forbidden.

## Correction

The existing shared Finalizer and migration paths now:

- admit the freeze only for `development / integration_workspace`;
- require every audited physical Field ID, name and type exactly;
- require preserved Window options in exact order `1 / 3 / 7 / 30`;
- require Number `window_days` and both retained Select sources to agree per Record;
- require canonical Text `display_name` on every Record;
- permit immutable Legacy display divergence only when canonical Text is present;
- overlay only the Integration Workspace executable schema so `window_days` remains Number;
- retain normal schema/migration behavior for every other customer profile;
- keep Field mutation, Legacy mutation and delete counts at zero.

Future Integration Workspace Metric writes mirror each reviewed rolling window into both Number `window_days` and the preserved Dashboard SingleSelect physical field so new Run All rows remain visible to existing Dashboard bindings.

## Required verification

```text
exact freeze preview     migrationCount=2 / pending=0 / blockers=0
Field mutation           0
Record mutation          0
Legacy mutation          0
Delete                    0
wrong Field identity      blocked
Number/Select mismatch    blocked
missing canonical display blocked
```

Full Repository gates and the Report Finalizer must pass before Readiness or Run All execution.

## Safety

```text
Implementation Remote action  0
Lark/D1/Queue/Worker           0/0/0/0
Dashboard PATCH               0
Field rename/delete           0
Schedule                      disabled
Production                    blocked
```
