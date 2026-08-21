# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = DASHBOARD_REMAINDER_AND_WORKFLOW_CLOSURE
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
CLONE_TABLES                        = 32
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN                         = PASS_0_MISMATCH
VIEW_SORT                           = PASS_42_VIEWS_0_MISMATCH
VIEW_GROUP                          = PASS_4_VIEWS_0_MISMATCH
VIEW_COLUMN_WIDTH                   = IGNORED_COSMETIC_BY_USER
VIEW_ROW_HEIGHT                     = IGNORED_COSMETIC_BY_USER
VIEW_FIELD_ORDER                    = PRESENTATION_ONLY_105_MISMATCH_VIEWS
VIEW_FROZEN_COLUMNS                 = PRESENTATION_ONLY_110_VIEWS
FORMULA_DEFINITION                  = AUTOMATIC_PASS_DO_NOT_REWRITE
FORMULA_PRESENTATION                = COMPLETE_4_OF_4
DYNAMIC_DATE_VIEW_FILTER            = LIVE_PASS_DO_NOT_RERUN
DASHBOARD_CONTAINERS                = PASS_6_OF_6
DASHBOARD_DOCUMENTED_BLOCKS         = PASS_66_OF_66_MISMATCH_0_DO_NOT_RERUN
DASHBOARD_UNSUPPORTED_COMPONENTS    = REMAINDER_7_SLICER_2_TABLE_VIEW
DASHBOARD_THEME                     = DEFERRED_CURRENT_GENERIC_CONTAINER_SPECIALIZED_ROUTE_CODE_1
WORKFLOW_NOTIFICATION               = DOCUMENTED_API_OPERATOR_STAGED_PREVIEW_PENDING
WORKFLOW_AI_MATERIALIZATION         = DOCUMENTED_API_SEMANTIC_CONVERSION_PENDING
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_REMAINDER_WORKFLOW_FINAL_EXPORT
```

## Closed — never rerun

The controlled automatic migration is closed. Final canonical verification passed with mismatch count `0`. The original checkpoint is immutable and must never be recreated.

Closed state also includes:

- 32 clone Tables and all migration-owned Fields/Records;
- Relations and Formula definitions;
- supported View filters/hierarchy and hidden fields;
- Advanced Permission parity covered by the controlled migration;
- protected `🎵 RAW_TikTok_Creator_Videos` remains zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete;
- View Sort 42 / Group 4 live write+readback PASS;
- Formula presentation 4/4 complete;
- Dynamic Date Filter live PASS;
- six Dashboard containers materialized under the approved folder;
- 66 documented Dashboard blocks materialized with mismatch count `0`.

Do not rerun automatic Apply, Sort/Group, Formula presentation, Dynamic Date Filter, or Dashboard documented-block materialization.

## Dashboard documented API closure

Current Source contains exactly six Dashboards / 75 blocks:

1. `💬 Customer Service & Leads` — 11
2. `🛡️ Data Quality & Operations` — 8
3. `📊 Executive Marketing Overview` — 11
4. `🌱 Organic Performance` — 22
5. `💰 Paid Ads Performance` — 13
6. `🛒 Commerce & Conversion` — 10

Exact current Source block-kind boundary:

```text
statistics     39   documented API — PASS
text           18   documented API — PASS
column          9   documented API — PASS
slicer          7   public Dashboard block enum absent
table_view      2   public Dashboard block enum absent
TOTAL          75
```

Live materialization result on exact branch HEAD `e40b23083126d8f6c8937683762985f5be73a486`:

```text
status                         DASHBOARD_DOCUMENTED_API_BLOCKS_PASS_WITH_UNSUPPORTED_REMAINDER
Dashboard containers           6 / 6
Documented blocks              66 / 66
Documented mismatch            0
Unsupported remainder          9
  slicer                       7
  table_view                   2
Table mutation                 0
Field mutation                 0
Record mutation                0
View mutation                  0
Formula mutation               0
Role mutation                  0
Workflow mutation              0
```

Branch Verification for that live materialization gate:

```text
Run 32480035425
Job 96764194928
SUCCESS
```

The documented-block stage is closed. Never rerun it unless a later read-only final audit proves drift.

## Dashboard theme incident and rule

Source theme is `summerBreeze`. Lark public Dashboard update documentation confirms this is a valid public enum and documents:

```text
PATCH /open-apis/base/v3/bases/{base_token}/dashboards/{dashboard_id}
body = {"theme":{"theme_style":"summerBreeze"}}
```

However the six customer Dashboards were materialized through the generic Base Block lifecycle so they could be created directly inside the approved Folder without staging elsewhere. Those containers successfully host all 66 Dashboard components through `/dashboards/{id}/blocks`, but the specialized Dashboard detail/update route rejects the same current container identity with:

```text
HTTP 200
Lark code 1
```

The first live Theme PATCH failed on `💬 Customer Service & Leads` with `completedDashboards=[]`; therefore confirmed Theme mutation count is `0`.

Do not retry the Theme PATCH on the current containers.

The Theme operator now has a mandatory specialized Dashboard `GET` preflight before any PATCH. If the current container shape returns the known `HTTP 200 / Lark code 1`, the operator must terminate safely with:

```text
DASHBOARD_THEME_DEFERRED_CONTAINER_UPDATE_UNSUPPORTED
```

and all mutation counts `0`.

Theme parity remains an explicit presentation remainder. Do not delete/recreate the six Dashboards or the 66 passed components just to set theme. Only reopen Theme if a documented conversion/attachment/update route for the current generic-created Dashboard container is proven.

## Dashboard unsupported component remainder

Current remainder remains exactly:

- 7 Slicers
- 2 Table View widgets

Do not send guessed internal chart kinds or decoded snapshot payloads to production. Close only through a documented/proven Dashboard component contract or minimal supported UI if the user explicitly chooses that path.

Known Table View semantic mappings:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

## Workflows

Two Source Workflows remain:

1. `AI Materialization → MKT_AI_Report_Runs`
2. `Eligible AI Run → Lark Group Notification`

Current official Lark CLI Base Workflow SSOT now proves public list/get/create/update/enable/disable contracts. Raw Source Draft/FlowSchema/auth/generated IDs still must never be replayed directly.

### Notification Workflow — documented API operator staged

Current Source semantic definition is exactly:

```text
Eligible AI Run → Lark Group Notification
status: disabled
AddRecordTrigger
  🧠 MKT_AI_Report_Runs.ai_run_key
  controls: pasteUpdate / automationBatchUpdate / openAPIBatchUpdate
→ Delay 1 minute
```

The current Source contains no message-send action in this Workflow. Parity must not invent one.

Staged operator:

- `scripts/lib/customer-base-notification-workflow-parity.js`
- `scripts/customer-base-notification-workflow-parity.mjs`
- `tests/scripts/customer-base-notification-workflow-parity.test.js`
- `docs/project-brain/customer-base-notification-workflow-documented-api-parity-2026-08-21.md`

Contract:

- exact Source SHA and exact Source two-Workflow fence;
- Source Table/Field IDs resolved locally to semantic names;
- Target protected anchors + `🧠 MKT_AI_Report_Runs.ai_run_key` preflight;
- public Workflow list/get only in preview;
- duplicate/conflicting same-title Workflow fails closed;
- absent Workflow is planned for one disabled create only;
- new Workflow remains disabled; operator has no enable path;
- readback verifies exact AddRecordTrigger → Delay definition and disabled status;
- rerun reuses an exact existing disabled Workflow with zero writes;
- no notification send, AI call, record mutation, update, delete, Worker/D1/Queue/schedule/deploy mutation.

Exact create confirmation:

`APPLY_CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PARITY_V1`

Focused synthetic regression passed 5/5 before repository staging. No customer Target Workflow mutation was executed while preparing this operator.

### AI Materialization Workflow

Still pending semantic conversion to the documented public Workflow schema. It contains a SetRecordTrigger, four native AI generation actions, output bindings and a final SetRecordAction. Convert from current Source semantic authority and Target Field IDs; do not replay Source/internal step IDs or raw Draft/FlowSchema payloads.

## No-repeat rules

1. Never create a new automatic-migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never rewrite the four Formula definitions.
5. Never rerun the passed Sort/Group runner.
6. Never rerun the passed Dynamic Date Filter mutation.
7. Never rerun Dashboard 66-block materialization.
8. Never retry Theme PATCH on the current generic-created Dashboard containers without a proven conversion/update route.
9. Never restore Width/RowHeight as parity requirements.
10. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
11. Never invent undocumented Slicer/Table View/Workflow write payloads.
12. Never enable `Eligible AI Run → Lark Group Notification` during parity; current Source status is disabled.
13. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Run focused notification Workflow regression + read-only preview on exact Source/Target.
2. Run Branch Verification on the same exact HEAD.
3. If preview and CI pass, perform one controlled disabled-only notification Workflow create/readback; never enable it.
4. Convert/close `AI Materialization → MKT_AI_Report_Runs` only through documented Workflow schema and current Source semantic authority.
5. Close 7 Slicer + 2 Table View + Theme through minimal supported UI unless a new proven API contract appears.
6. Export Target once and run final parity verification.
7. Ready/Merge PR #661 only on explicit user instruction.
