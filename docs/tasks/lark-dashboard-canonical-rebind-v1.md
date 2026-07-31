# Lark Dashboard Canonical Rebind v1

## Status

```text
TASK_STATUS       = APPROVED_FOR_IMPLEMENTATION
WORKSTREAM        = REPORT_DASHBOARD_BINDING
BASE_MAIN_SHA     = 17c59e1196a1713aa19bacac41e8d101dfe7ceb0
PRODUCTION        = BLOCKED
SCHEDULE          = DISABLED
REMOTE_ACTIONS    = 0 during implementation
```

## Incident

`MKT_Report_Metric_Values` contains the completed 1D/3D/7D/30D Report rows, but the existing
Dashboards still bind 26 blocks to retained migration fields:

- 17 Organic KPI cards filter `__mkt_legacy_display_name_single_select_v2`;
- nine slicer/window blocks across five Dashboards use
  `__mkt_legacy_window_days_single_select_v1`;
- the canonical runtime writes `metric_key`, Text `display_name`, and Number `window_days`.

The Report readiness verifier proved D1/Lark record parity but did not read Dashboard block
configuration or computed chart data. Therefore data materialization passed while the existing
Dashboard rendered empty cards.

## Objective

Rebind the already-created Dashboard blocks in place. Preserve Dashboard IDs, Block IDs, chart types,
layout, names and records. After computed-data verification succeeds, delete the four deterministic
Legacy migration fields so the final schema has one canonical field per concept.

## Contract

- Use Lark Base v3 Dashboard Block read/update APIs.
- Update only `data_config`; never recreate or rearrange existing blocks.
- Bind the 17 Organic KPI cards by exact stable `metric_key`.
- Replace every Legacy window field reference with Number `window_days` across all six Dashboards.
- Read every affected block back after PATCH.
- Verify the 17 Organic blocks through Dashboard computed-data API.
- Allow the six period-delta metrics to remain baseline-incomplete/N/A; do not delete their records or
  convert null to zero.
- Backup Legacy values privately before field deletion.
- Delete only these reviewed fields:
  - `__mkt_legacy_display_name_single_select_v1`
  - `__mkt_legacy_display_name_single_select_v2`
  - `__mkt_legacy_window_days_single_select_v1`
  - `__mkt_legacy_window_days_single_select_v2`
- Fail closed for unknown Legacy fields, missing/duplicate Dashboards, missing KPI blocks, unexpected
  Legacy references, non-converged readback or missing computed values.

## Required permissions

The connected Lark app must be allowed to read/update Dashboards and delete Base fields. Permission
failure must occur during preflight or the exact failed stage; it must not be bypassed with manual
Dashboard remapping.

## Public execution

```bash
CONFIRM_LARK_DASHBOARD_CANONICAL_REBIND=REBIND_EXISTING_DASHBOARDS_AND_REMOVE_LEGACY_FIELDS \
node scripts/lark-dashboard-canonical-rebind.mjs --execute
```

The command requires a clean Repository whose `HEAD` equals `origin/main`. It writes private evidence
under `outputs/lark-dashboard-canonical-rebind-v1/` and is safe to resume from live state after a
partial block update or partial Legacy field deletion.

## Acceptance criteria

- Six reviewed Dashboards resolve exactly once.
- Organic Performance has the exact 17 KPI blocks.
- All 17 KPI blocks use exact `metric_key` filters.
- All Dashboard block configs contain zero `__mkt_legacy_*` references.
- 11 currently available Organic metrics return computed numeric values.
- Six period metrics remain explicit baseline-incomplete/N/A, not fake zero and not deleted.
- Four Legacy fields are absent after cleanup.
- Dashboard IDs and Block IDs are preserved; layout mutation count is zero.
- Record delete count and Business-fact mutation count are zero.
- Unit, Workers runtime, Report reliability, architecture/hygiene, audit and Wrangler dry-run gates pass.
