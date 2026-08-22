# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = UI_PARITY_CLOSEOUT
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE
CLONE_TABLES                        = 32
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
VIEW_FIELD_ORDER                    = OPEN_BLOCKER_105_OF_110_MISMATCH
VIEW_FROZEN_COLUMNS                 = CLOSED_MATCHING
FORMULA_DEFINITION                  = CLOSED_PASS_DO_NOT_REWRITE
FORMULA_PRESENTATION                = CLOSED_4_OF_4
DYNAMIC_DATE_VIEW_FILTER            = CLOSED_LIVE_PASS_DO_NOT_RERUN
DASHBOARD_CONTAINERS                = CLOSED_6_OF_6
DASHBOARD_DOCUMENTED_BLOCKS         = CLOSED_66_OF_66_MISMATCH_0_DO_NOT_RERUN
DASHBOARD_MANUAL_REMAINDER          = OPEN_7_SLICERS_2_TABLE_VIEWS_THEME
AUTOMATION_AI_MATERIALIZATION       = AUTOMATION_CENTER_ACTIVE_PARITY
AUTOMATION_NOTIFICATION             = AUTOMATION_CENTER_INACTIVE_PARITY
WRONG_BASE_V3_WORKFLOW              = MANUALLY_DELETED_FROM_TARGET
ADVANCED_PERMISSION_ROLES           = OUT_OF_SCOPE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_UI_PARITY_AND_FINAL_EXPORT
```

## Authority and scope

Current Source authority is `Social MKT Data Hub.base` with SHA-256
`9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`.

Stable Source structure used by this closeout:

- 33 Tables
- 723 Fields
- 111 Views
- 12 Relations
- 4 Formulas
- 6 Dashboards
- 2 Automation Center automations

Clone scope excludes the protected customer table `🎵 RAW_TikTok_Creator_Videos` and is exactly 32 Tables / 705 Fields / 110 Views. The protected table remains zero-write.

Column width is explicitly out of acceptance scope by user decision. Advanced Permission Roles are also out of acceptance scope because this Base does not use them for this migration.

## Closed — never rerun

The controlled automatic migration is closed. Do not recreate its checkpoint or replay Apply.

The following lanes are closed and must not be mutated merely to close presentation parity:

- migration-owned Table/Field/Record schema and record-to-field bindings;
- Relations and Formula definitions;
- hidden-field parity;
- View Sort 42/42;
- View Group 4/4;
- Formula presentation 4/4;
- Dynamic Date Filter;
- six Dashboard containers;
- 66 documented/API-supported Dashboard blocks;
- row-height/frozen state already read back as matching;
- Automation Center definitions/status after manual parity closure.

Do not touch Worker, D1, Queue, schedules or deployments in this workstream.

## OPEN blocker 1 — View field order

The latest read-only Source-vs-Target comparison proves:

```text
cloned grid Views         110
exact field order           5
field-order mismatches    105
affected cloned Tables     31
```

The five exact Views are the `🔄 MKT_Sync_Log` Views and must not be touched.

This defect is display order only. Record values remain attached to the correct Field IDs. Never rewrite, backfill, move or copy record values to fix it.

Field order is a blocking parity dimension. `FULL_PARITY_PASS` is forbidden while the in-scope field-order mismatch count is greater than zero, unless the user later explicitly excludes field order. The user excluded width, not field order.

Official Grid View JS SDK documentation exposes `getFieldMetaList()` to read fields in UI order, but no documented setter for reordering fields in an existing Grid View. Therefore:

- do not guess `property.fields`, `fieldOrder` or any undocumented remote write payload;
- close mismatching View order through the safe UI/manual lane;
- preserve filter, hidden state, sort, group, row height, frozen state and record/schema state;
- after completion, export Target once and run the shared read-only comparison.

Closeout implementation uses the existing shared parity path only:

- `scripts/lib/lark-base-view-manual-parity-manifest.js` — Source/Target manifest builder + shared verifier; `includeColumnWidths:false` keeps field order blocking while excluding width.
- `tests/scripts/lark-base-view-manual-parity-scope.test.js` — regression proving width-only drift is ignored and field-order drift still blocks.
- `scripts/customer-base-view-manual-parity-manifest.mjs` — pinned current Source authority manifest operator.
- `scripts/customer-base-view-export-parity.mjs` — direct Source `.base` vs Target `.base` local/read-only verifier for the 32-table clone scope.
- `docs/customer-base-view-order-closeout.md`
- `docs/customer-base-view-order-manual-closeout.md`
- `docs/customer-base-view-order-capability-note.md`
- `docs/customer-base-view-order-root-cause.md`
- `docs/customer-base-field-order-acceptance.md`
- `docs/customer-base-width-out-of-scope.md`

No second/parallel field-order engine is retained.

## OPEN blocker 2 — Dashboard manual parity

Source contains six Dashboards / 75 components. The documented/API-supported lane materialized and verified 66/66 components and is closed.

Manual remainder still open:

- 7 slicers
- 2 table_view widgets
- Source theme `summerBreeze`

Exact missing components:

- `💬 Customer Service & Leads` — `📅 Period`
- `🛡️ Data Quality & Operations` — `🚨 Recent System Alerts`, `🔄 Latest Sync Runs`
- `📊 Executive Marketing Overview` — `📅 Period`
- `🌱 Organic Performance` — `📱 Channel`, `📅 Period`
- `💰 Paid Ads Performance` — `📱 Channel`, `📅 Period`
- `🛒 Commerce & Conversion` — `📅 Period`

Known Table View mappings:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

Never rerun the 66 documented blocks and never retry the failed Theme API PATCH path. Close the remainder in the Lark UI and verify it from a fresh Target export.

## Automation Center — CLOSED

Correct Source/Target Automation Center state:

1. `AI Materialization → MKT_AI_Report_Runs` — Active
2. `Eligible AI Run → Lark Group Notification` — Inactive

The earlier Base v3 Workflow object was a different Lark product surface, was proven non-parity, and was manually deleted from Target. Do not recreate it. Do not use Base v3 Workflow as a substitute for Automation Center parity.

## No-repeat rules

1. Never create a new automatic-migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records for this remainder.
4. Never rewrite the four Formula definitions.
5. Never rerun passed Sort/Group work.
6. Never rerun passed Dynamic Date Filter work.
7. Never rerun Dashboard 66-block materialization.
8. Never retry Theme PATCH on the current Dashboard containers.
9. Never restore Width as a parity requirement.
10. Never mutate Source, protected TikTok table, Worker, D1, Queue, schedule or deployment.
11. Never invent undocumented View reorder, Dashboard block or Workflow payloads.
12. Never enable `Eligible AI Run → Lark Group Notification`; Source status is Inactive.
13. Never recreate the wrong Base v3 sidebar Workflow.
14. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Close the 105 mismatching View field orders in place using the exact Source order checklist; leave the 5 exact `🔄 MKT_Sync_Log` Views untouched.
2. Export Target and run `scripts/customer-base-view-export-parity.mjs`; required result is 32 Tables / 705 Fields / 110 Views in clone scope with zero blocking View mismatches and zero field-order mismatches. Width is excluded.
3. Close Dashboard manual remainder: 7 slicers + 2 table_view widgets + `summerBreeze` presentation.
4. Export Target once more and run final read-only parity within the agreed scope.
5. Only after both UI blockers are closed may the workstream report `FULL_PARITY_PASS`.
6. Ready/Merge PR #661 only on explicit user instruction.
