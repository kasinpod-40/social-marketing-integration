# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = CUSTOMER_BASE_ACCEPTED_COMPLETE
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE
CLONE_TABLES                        = 32
CLONE_FIELDS                        = 705
PROTECTED_EXTERNAL_TABLES           = 1
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
FINAL_TARGET_EXPORT_SHA256          = c27418a2247b7b4e068cc372597efc9c671e6d5d34c7d05806a6e9b6175a52d1
AUTOMATIC_CANONICAL_VERIFY          = CLOSED_PASS_DO_NOT_RERUN
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN                         = CLOSED_PASS_0_MISMATCH
VIEW_SORT                           = CLOSED_PASS_42_VIEWS_0_MISMATCH
VIEW_GROUP                          = CLOSED_PASS_4_VIEWS_0_MISMATCH
VIEW_COLUMN_WIDTH                   = OUT_OF_SCOPE_BY_USER
VIEW_FIELD_ORDER                    = ACCEPTED_NON_BLOCKING_UI_DIFFERENCE
VIEW_ROW_HEIGHT                     = CLOSED_MATCHING
VIEW_FROZEN_COLUMNS                 = CLOSED_MATCHING
FORMULA_DEFINITION                  = CLOSED_PASS_DO_NOT_REWRITE
FORMULA_PRESENTATION                = CLOSED_4_OF_4
DYNAMIC_DATE_VIEW_FILTER            = CLOSED_LIVE_PASS_DO_NOT_RERUN
DASHBOARD_CONTAINERS                = CLOSED_6_OF_6
DASHBOARD_COMPONENTS                = CLOSED_75_OF_75
DASHBOARD_SLICERS                   = CLOSED_7_OF_7
DASHBOARD_TABLE_VIEWS               = CLOSED_2_OF_2
DASHBOARD_THEME                     = CLOSED_SUMMER_BREEZE_6_OF_6
DASHBOARD_PIXEL_LAYOUT              = ACCEPTED_NON_BLOCKING_UI_DIFFERENCE
AUTOMATION_AI_MATERIALIZATION       = AUTOMATION_CENTER_ACTIVE_PARITY
AUTOMATION_NOTIFICATION             = AUTOMATION_CENTER_INACTIVE_PARITY
WRONG_BASE_V3_WORKFLOW              = MANUALLY_DELETED_FROM_TARGET
ADVANCED_PERMISSION_ROLES           = OUT_OF_SCOPE_BY_USER
CUSTOMER_ACCEPTANCE_RULE            = DATA_AND_FUNCTION_COMPLETE_UI_MAY_DIFFER
DRAFT_PR                            = 661
PRODUCTION                          = CUSTOMER_BASE_ACCEPTED_COMPLETE_PENDING_MERGE_AUTHORIZATION
```

## Final customer acceptance decision

On 2026-08-23 the customer explicitly accepted the following final boundary:

> UI may differ or only be similar; if the data/content is complete and correct, the Base is finished.

Therefore exact View column order and exact Dashboard pixel/layout similarity are no longer blocking acceptance criteria. Column width and Advanced Permission Roles were already out of scope.

## Final Target export evidence

Latest inspected export:

- `✨Marketing Content Calendar(1).base`
- SHA-256 `c27418a2247b7b4e068cc372597efc9c671e6d5d34c7d05806a6e9b6175a52d1`
- Base revision `146`
- local/read-only inspection only

Result:

- 36 unique Target Tables total
- all 32 clone Tables present
- clone Fields `705/705`
- Relations `12/12`
- Formulas `4/4`
- current clone records `34,532`
- duplicate clone primary keys `0`
- protected `🎵 RAW_TikTok_Creator_Videos` remains present and excluded from clone parity
- pre-existing customer Tables remain present

The export contains 112 clone-scope Views because adding the two Dashboard table-view widgets caused Lark to create two internal `dashboard_view` Views. These are additive internal views, not missing/replaced Source views.

One empty unkeyed row exists in technical table `🔄 MKT_Sync_Log`. It does not replace a keyed Source/business record and is non-blocking under the accepted functional/data-completeness rule.

## Dashboard final evidence

Source expected six MKT Dashboards / 75 components. Final Target export has exactly 75 MKT Dashboard components:

- `💬 Customer Service & Leads` — 11
- `🌱 Organic Performance` — 22
- `💰 Paid Ads Performance` — 13
- `🛒 Commerce & Conversion` — 10
- `📊 Executive Marketing Overview` — 11
- `🛡️ Data Quality & Operations` — 8

Manual remainder is now materially present:

- 7 slicers
- 2 table-view blocks
- `themeStyle = summerBreeze` on all six MKT Dashboards

The two table-view blocks are bound to the correct operational Tables. Lark stores them through generated internal `dashboard_view` Views.

Paid Ads channel slicer is present and bound to `platform`; the export does not encode a default selection. That is a UI/default-state difference and is non-blocking under the final customer acceptance rule.

## Automation Center — CLOSED

Correct Source/Target Automation Center state remains:

1. `AI Materialization → MKT_AI_Report_Runs` — Active
2. `Eligible AI Run → Lark Group Notification` — Inactive

Do not recreate the wrong Base v3 sidebar Workflow.

## No-repeat rules

1. Never create a new migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never rerun visible-field-order automatic Apply.
4. Never delete/recreate migration-owned Tables/Fields/Records for cosmetic parity.
5. Never rewrite Formula definitions.
6. Never rerun passed Sort/Group/Dynamic Date Filter lanes.
7. Never rerun Dashboard 66-block materialization.
8. Never retry Dashboard Theme API PATCH.
9. Never restore Width, exact field order, exact pixel layout or Advanced Permission Roles as blockers unless the customer explicitly changes scope again.
10. Never mutate Source, protected TikTok, Worker, D1, Queue, schedules or deployments as part of this Base closeout.
11. Never enable `Eligible AI Run → Lark Group Notification`; Source status is Inactive.
12. PR #661 remains Draft/Open/Unmerged until explicit merge authorization.

## Final state

Customer Base work is accepted complete under the agreed functional/data-completeness scope.

Remaining repository action only: Ready/Merge PR #661 when the user explicitly authorizes merge.
