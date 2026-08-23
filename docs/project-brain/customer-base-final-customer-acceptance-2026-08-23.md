# Customer Base final customer acceptance — 2026-08-23

## Decision

Customer explicitly accepted functional/data parity as the final acceptance boundary: UI may differ or only be similar; if the data/content is complete and correct, the customer Base is considered finished.

Final status: `CUSTOMER_BASE_ACCEPTED_COMPLETE`.

This replaces exact View column order and pixel/layout similarity as blocking acceptance criteria. Column width and Advanced Permission Roles were already out of scope.

## Final Target export inspected

- File: `✨Marketing Content Calendar(1).base`
- SHA-256: `c27418a2247b7b4e068cc372597efc9c671e6d5d34c7d05806a6e9b6175a52d1`
- Base name: `✨Marketing Content Calendar`
- Base revision in export: `146`

Inspection was local/read-only. No Target mutation was performed by this audit.

## Structural/data integrity result

Target contains 36 unique Tables total:

- 32 migration clone Tables — all expected clone table names present
- protected external `🎵 RAW_TikTok_Creator_Videos`
- 3 pre-existing customer-only Tables

Clone scope in the final export:

- Tables: `32/32`
- Fields: `705/705`
- Relations: `12/12`
- Formulas: `4/4`
- Current clone records: `34,532`
- Duplicate primary keys found across clone Tables: `0`

The current export contains 112 clone-scope Views because Lark created two dashboard-owned internal `dashboard_view` Views when the two table-view dashboard blocks were added. These are additional internal Views, not missing/replaced Source Views:

- `🚨 MKT_System_Alerts → Grid 5(dashboard_view)`
- `🔄 MKT_Sync_Log → Grid 6(dashboard_view)`

One extra blank technical row exists in `🔄 MKT_Sync_Log` with no `sync_id`. It is an unkeyed empty operational-log row; it does not replace a keyed Source/business record and is non-blocking under the accepted functional/data-completeness boundary.

Protected/customer state in the export:

- `🎵 RAW_TikTok_Creator_Videos`: 2,046 records, still protected/excluded from clone parity
- customer-only Tables remain present

Previously closed canonical schema/data parity remains authoritative and no destructive Table/Field/Record migration lane was rerun after closure.

## Dashboard final result

The six MKT Dashboards now contain exactly `75` components, matching Source aggregate inventory.

Per-dashboard component counts:

- `💬 Customer Service & Leads` — 11
- `🌱 Organic Performance` — 22
- `💰 Paid Ads Performance` — 13
- `🛒 Commerce & Conversion` — 10
- `📊 Executive Marketing Overview` — 11
- `🛡️ Data Quality & Operations` — 8

Manual remainder is materially present:

- slicers: `7`
- table-view blocks: `2`

All six MKT Dashboard snapshots now carry `themeStyle = summerBreeze`.

Slicer bindings found in the final export:

- Customer Service `📅 Period` → `__mkt_legacy_window_days_single_select_v1`, default 7
- Organic `📱 Channel` → `platform`, default tiktok
- Organic `📅 Period` → period helper field, default 7
- Paid Ads `📱 Channel` → `platform`
- Paid Ads `📅 Period` → period helper field, default 7
- Commerce `📅 Period` → period helper field, default 7
- Executive `📅 Period` → period helper field, default 7

The Paid Ads channel slicer is present and bound to `platform`; its current export does not encode a default selection. This is a UI/default-state difference and is non-blocking under the customer's final acceptance rule.

The two Data Quality table-view blocks point to the correct Tables. Lark materialized internal `dashboard_view` copies for those blocks; their semantics are equivalent to the selected dashboard views aside from non-functional internal-view representation differences.

## Automation Center final result

The two migrated parity automations remain present with the correct status:

1. `AI Materialization → MKT_AI_Report_Runs` — Active
2. `Eligible AI Run → Lark Group Notification` — Inactive

The earlier wrong Base v3 sidebar Workflow remains absent from the accepted parity definition.

## Acceptance scope now closed

Blocking acceptance now requires functional/data correctness, not exact cosmetic parity.

Closed / accepted:

- Table set and clone scope
- Field/schema parity
- record/data integrity under the previously closed canonical parity gate
- Relations and Formulas
- hidden/sort/group/dynamic-date behavior already closed
- Dashboard content completeness: 75/75 components
- 7 slicers + 2 table views present
- `summerBreeze` theme present on all six MKT Dashboards
- Automation Center definitions/status
- folder placement

Explicitly non-blocking:

- exact View column order
- exact Dashboard pixel/layout similarity
- column widths
- Advanced Permission Roles
- UI-only default-state differences that do not change underlying data/content

## Safety / no-repeat

Do not rerun:

- controlled automatic migration Apply
- visible-field-order automatic Apply
- Dashboard 66-block materialization
- Theme API PATCH
- passed Sort/Group/Dynamic Date Filter lanes

Do not mutate Source, protected TikTok, Worker, D1, Queue, schedules or deployments as part of customer Base closeout.

PR #661 should remain Draft/Open/Unmerged until explicit merge authorization, even though customer Base acceptance itself is now complete.
