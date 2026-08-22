# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = DOCUMENTED_VIEW_ORDER_LIVE_CLOSEOUT
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
VIEW_FIELD_ORDER                    = DOCUMENTED_VISIBLE_FIELDS_OPERATOR_READY_LIVE_PENDING
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
PRODUCTION                          = BLOCKED_PENDING_VIEW_ORDER_DASHBOARD_FINAL_EXPORT
```

## Authority and scope

Current Source authority is `Social MKT Data Hub.base` with SHA-256
`9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`.

Source structure used by this closeout:

- 33 Tables
- 723 Fields
- 111 Views
- 12 Relations
- 4 Formulas
- 6 Dashboards
- 2 Automation Center automations

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

## OPEN blocker 1 — View visible-field order

Earlier Source-vs-Target export comparison found 105/110 full exported `fieldOrder` mismatches. Record values remain attached to the correct Field IDs.

### Corrected capability discovery

The earlier manual-only conclusion was incomplete. Official `larksuite/cli` documents Base v3:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

Official guidance states that `visible_fields` controls both visibility and order.

The repository already used this property for hidden-field parity, but intentionally sorted readback before comparing membership. That correctly verified hidden membership while ignoring order, which allowed order drift to survive the hidden-field gate.

### Implemented repair

Existing documented View parity module now contains:

- `planLarkBaseDocumentedVisibleFieldOrderParity`
- `applyLarkBaseDocumentedVisibleFieldOrderParity`
- confirmation `APPLY_CUSTOMER_BASE_VISIBLE_FIELD_ORDER_V1`

Production operator:

- `scripts/customer-base-visible-field-order-parity.mjs`

Safety contract:

- exact Source SHA required;
- exact 32 Tables / 705 Fields / 110 Views clone scope required;
- Target identity anchors required;
- protected TikTok excluded;
- full read-only plan before writes;
- Target visible membership must already equal Source visible membership;
- only mismatching order is written;
- exact ordered GET readback after each PUT;
- all changed Views roll back on any failure;
- no Table/Field/Record/Filter/Sort/Group/Formula/Dashboard/Automation/Worker/D1/Queue/schedule mutation.

Displayed-column acceptance compares **visible field order**. Hidden membership is an independent already-closed gate; relative positions of hidden fields inside exported full `fieldOrder` are not displayed-column order.

Final export verifier `scripts/customer-base-view-export-parity.mjs` now projects field order to visible fields before comparison and continues to exclude width.

## OPEN blocker 2 — Dashboard manual parity

Source contains six Dashboards / 75 components. The documented/API-supported lane materialized and verified 66/66 components and is closed.

Remaining manual UI components:

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

Never rerun the 66 documented blocks and never retry the failed Theme API PATCH path.

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
8. Never restore Width or Advanced Permission Roles as acceptance requirements unless user explicitly changes scope.
9. Never mutate Source, protected TikTok table, Worker, D1, Queue, schedule or deployment.
10. Never use undocumented View reorder payloads; only documented `visible_fields` is allowed for this lane.
11. Never enable `Eligible AI Run → Lark Group Notification`; Source status is Inactive.
12. Never recreate the wrong Base v3 sidebar Workflow.
13. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Run focused syntax/tests on the exact branch HEAD.
2. Run read-only Target preview: `node scripts/customer-base-visible-field-order-parity.mjs --preview`.
3. Preview must cover exactly 110 Views with zero blockers.
4. Perform one confirmed order-only apply using `APPLY_CUSTOMER_BASE_VISIBLE_FIELD_ORDER_V1`.
5. Live readback must finish with 110/110 Views exact and zero rollback failures.
6. Export Target and run `scripts/customer-base-view-export-parity.mjs`; in-scope View mismatches must be zero.
7. Close Dashboard manual remainder.
8. Export Target once more and run final read-only parity within agreed scope.
9. Ready/Merge PR #661 only on explicit user instruction.
