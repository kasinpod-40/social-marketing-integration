# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = FINAL_MANUAL_UI_CLOSEOUT
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE
CLONE_TABLES                        = 32
CLONE_FIELDS                        = 705
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
AUTOMATIC_CANONICAL_VERIFY          = CLOSED_PASS_DO_NOT_RERUN
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN                         = CLOSED_PASS_0_MISMATCH
VIEW_SORT                           = CLOSED_PASS_42_VIEWS_0_MISMATCH
VIEW_GROUP                          = CLOSED_PASS_4_VIEWS_0_MISMATCH
VIEW_COLUMN_WIDTH                   = OUT_OF_SCOPE_BY_USER
VIEW_ROW_HEIGHT                     = CLOSED_MATCHING
VIEW_FIELD_ORDER                    = MANUAL_UI_ONLY_AUTOMATIC_LANE_CLOSED
VIEW_FROZEN_COLUMNS                 = CLOSED_MATCHING
FORMULA_DEFINITION                  = CLOSED_PASS_DO_NOT_REWRITE
FORMULA_PRESENTATION                = CLOSED_4_OF_4
DYNAMIC_DATE_VIEW_FILTER            = CLOSED_LIVE_PASS_DO_NOT_RERUN
DASHBOARD_CONTAINERS                = CLOSED_6_OF_6
DASHBOARD_DOCUMENTED_BLOCKS         = CLOSED_66_OF_66_MISMATCH_0_DO_NOT_RERUN
DASHBOARD_MANUAL_REMAINDER          = MANUAL_UI_7_SLICERS_2_TABLE_VIEWS_THEME
AUTOMATION_AI_MATERIALIZATION       = AUTOMATION_CENTER_ACTIVE_PARITY
AUTOMATION_NOTIFICATION             = AUTOMATION_CENTER_INACTIVE_PARITY
WRONG_BASE_V3_WORKFLOW              = MANUALLY_DELETED_FROM_TARGET
ADVANCED_PERMISSION_ROLES           = OUT_OF_SCOPE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_MANUAL_UI_AND_FINAL_EXPORT
```

## Authority and scope

Current Source authority is `Social MKT Data Hub.base` SHA-256 `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`.

Source structure: 33 Tables / 723 Fields / 111 Views / 12 Relations / 4 Formulas / 6 Dashboards / 2 Automation Center automations.

Clone scope excludes protected customer table `🎵 RAW_TikTok_Creator_Videos` and is exactly 32 Tables / 705 Fields / 110 Views. The protected table remains zero-write.

Column width and Advanced Permission Roles are excluded from final acceptance by user decision.

## Closed — never rerun

The following lanes are closed and must not be replayed merely to finish UI parity:

- automatic migration/checkpoint/apply;
- canonical schema/data parity;
- hidden fields;
- View Sort 42/42;
- View Group 4/4;
- Formula definitions and Formula presentation 4/4;
- Dynamic Date Filter;
- six Dashboard containers;
- 66 documented/API-supported Dashboard blocks;
- row-height/frozen state already read back as matching;
- Automation Center definitions/status.

Never mutate Source, protected TikTok table, Worker, D1, Queue, schedules or deployments in this workstream.

## OPEN blocker 1 — View field order: MANUAL UI ONLY

The last Source-vs-Target export comparison found 105/110 displayed-column order mismatches. Record values remain attached to the correct Field IDs. Width is not part of this lane.

Two confirmed documented Base v3 `PUT .../visible_fields` attempts were made. Both failed safely on the customer Target:

1. First attempt reached four View updates, then Lark returned `800070003 api_error: no operation produced`; rollback restored all four with zero rollback failures.
2. Second attempt accepted `800070003` only when immediate ordered GET readback proved the requested order was already exact. It failed on `📐 MKT_Metric_Definitions → 📋 All Metrics` because readback still differed. Again, all four earlier changes rolled back with zero rollback failures.

The Base JS SDK provides ordered reads but no documented existing-View reorder setter. Therefore the automatic field-order lane is CLOSED. Do not retry it, do not ignore `800070003`, do not temporarily hide/show fields to force reordering, and do not recreate Views.

Manual acceptance rule:

- reorder columns in existing Views only;
- preserve field visibility, filters, sorts, groups, row height and frozen state;
- do not resize columns as part of parity;
- do not touch `🎵 RAW_TikTok_Creator_Videos`;
- `🔄 MKT_Sync_Log` five Views were already exact in the latest comparison and should be skipped unless a fresh export proves drift.

Source field-order authority remains the exact Source export / generated manual manifest.

## OPEN blocker 2 — Dashboard: MANUAL UI ONLY

Source contains six Dashboards / 75 components. The documented/API-supported lane materialized and verified 66/66 and is closed.

Remaining manual UI work:

### 💬 Customer Service & Leads
- add slicer `📅 Period`
- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- single select / tiled / default `7`
- Source grid position: x9 y2 w3 h1

### 🛡️ Data Quality & Operations
- add table view `🚨 Recent System Alerts`
  - table `🚨 MKT_System_Alerts`
  - view `📊 Dashboard Alerts`
  - x0 y9 w12 h4
- add table view `🔄 Latest Sync Runs`
  - table `🔄 MKT_Sync_Log`
  - view `📊 Dashboard Sync Health`
  - x0 y5 w12 h4

### 📊 Executive Marketing Overview
- add slicer `📅 Period`
- same period field / default `7`
- x9 y2 w3 h1

### 🌱 Organic Performance
- add slicer `📱 Channel`
  - table `📊 MKT_Report_Metric_Values`
  - field `platform`
  - single select / tiled / default `tiktok`
  - x0 y2 w9 h1
- add slicer `📅 Period`
  - period field / default `7`
  - x9 y2 w3 h1

### 💰 Paid Ads Performance
- add slicer `📱 Channel`
  - table `📊 MKT_Report_Metric_Values`
  - field `platform`
  - single select / tiled / default `meta_ads`
  - x0 y2 w9 h1
- add slicer `📅 Period`
  - period field / default `7`
  - x9 y2 w3 h1

### 🛒 Commerce & Conversion
- add slicer `📅 Period`
- period field / default `7`
- x9 y2 w3 h1

All six MKT Dashboards must use Source theme `summerBreeze`.

Never rerun the 66 documented blocks and never retry the failed Dashboard Theme API PATCH lane.

## Automation Center — CLOSED

Correct Source/Target Automation Center state:

1. `AI Materialization → MKT_AI_Report_Runs` — Active
2. `Eligible AI Run → Lark Group Notification` — Inactive

The earlier Base v3 Workflow object was a different Lark product surface and was manually deleted from Target. Do not recreate it.

## No-repeat rules

1. Never create a new automatic-migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never rewrite Formula definitions.
5. Never rerun passed Sort/Group/Dynamic Date Filter lanes.
6. Never rerun Dashboard 66-block materialization.
7. Never retry Theme PATCH on current Dashboard containers.
8. Never retry the visible-field-order automatic apply.
9. Never restore Width or Advanced Permission Roles as acceptance requirements unless user explicitly changes scope.
10. Never mutate Source, protected TikTok table, Worker, D1, Queue, schedule or deployment.
11. Never enable `Eligible AI Run → Lark Group Notification`; Source status is Inactive.
12. Never recreate the wrong Base v3 sidebar Workflow.
13. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Complete manual View field-order parity against Source authority.
2. Complete the Dashboard manual remainder: 7 slicers + 2 table views + `summerBreeze` on all six MKT Dashboards.
3. Export Target `.base` once after both manual lanes are complete.
4. Run only final read-only export/parity verification within the agreed scope.
5. If final mismatch is zero, update closure evidence.
6. Ready/Merge PR #661 only on explicit user instruction.
