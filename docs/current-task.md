# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = WORKFLOW_CLOSURE_AND_FINAL_EXPORT
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
DASHBOARD_MANUAL_REMAINDER          = USER_ACCEPTED_7_SLICER_2_TABLE_VIEW_THEME
WORKFLOW_NOTIFICATION               = DOCUMENTED_API_READY_PREVIEW_CI_LIVE_CREATE_PENDING
WORKFLOW_AI_MATERIALIZATION         = DOCUMENTED_TYPES_READY_NULL_CLEAR_BLOCKED
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_WORKFLOW_FINAL_EXPORT
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

## Dashboard closure

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
slicer          7   public Dashboard block enum absent — manual remainder
table_view      2   public Dashboard block enum absent — manual remainder
TOTAL          75
```

Live documented-block materialization:

```text
HEAD                           e40b23083126d8f6c8937683762985f5be73a486
Branch Verification Run        32480035425
Branch Verification Job        96764194928
Result                          SUCCESS
Dashboard containers           6 / 6
Documented blocks              66 / 66
Documented mismatch            0
Table/Field/Record/View/etc.    0 mutation
```

The 66-block stage is closed. Never rerun it unless a later read-only final audit proves drift.

### Dashboard presentation remainder

Remaining Dashboard presentation-only parity is:

- 7 Slicers;
- 2 Table View widgets;
- Source theme `summerBreeze`.

The user accepted handling this remainder manually. It no longer blocks the API workstream.

Known Table View semantic mappings:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

Theme rule remains fail-closed: the six current generic-created Dashboard containers host all 66 documented components, but specialized Dashboard GET/PATCH rejects their current identity with HTTP 200 / Lark code 1. The first Theme PATCH failed before any completed Dashboard (`completedDashboards=[]`), so confirmed Theme mutation count is `0`. Never retry Theme PATCH on these containers and never delete/recreate them just to set theme.

## Workflows

Two Source Workflows remain:

1. `AI Materialization → MKT_AI_Report_Runs`
2. `Eligible AI Run → Lark Group Notification`

Current official Lark CLI Base Workflow SSOT proves public list/get/create/update/enable/disable contracts. Raw Source Draft/FlowSchema/auth/generated IDs must never be replayed directly.

### Notification Workflow — documented API ready

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

Files:

- `scripts/lib/customer-base-notification-workflow-parity.js`
- `scripts/lib/customer-base-workflow-placement.js`
- `scripts/customer-base-notification-workflow-parity.mjs`
- `tests/scripts/customer-base-notification-workflow-parity.test.js`
- `tests/scripts/customer-base-workflow-placement.test.js`
- `docs/project-brain/customer-base-notification-workflow-documented-api-parity-2026-08-21.md`

Contract:

- exact Source SHA and exact Source two-Workflow fence;
- Source Table/Field IDs resolved locally to semantic names;
- Target protected anchors + `🧠 MKT_AI_Report_Runs.ai_run_key` preflight;
- public Workflow list/get only in preview;
- duplicate/conflicting same-title Workflow fails closed;
- absent Workflow is planned for one disabled create only;
- new Workflow remains disabled; operator has no enable/update/message path;
- readback verifies exact AddRecordTrigger → Delay definition and disabled status;
- deterministic create token + list discovery makes ambiguous create resumable;
- Base Block topology resolves the approved folder and Workflow block identity;
- official Base Block contract confirms Workflow block `id` equals `workflow_id`;
- if needed, move only the Workflow block under `Setup Phase | Social MKT Data Hub` and list-readback placement;
- if create succeeds but move fails, rerun reuses the same disabled Workflow and performs only the missing move;
- no notification send, AI call, record mutation, delete, Worker/D1/Queue/schedule/deploy mutation.

Exact create confirmation:

`APPLY_CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PARITY_V1`

Required Lark permission bundle for this phase:

```text
base:workflow:read
base:workflow:create
base:block:read      # already required by Dashboard work
base:block:update
```

Do not add `base:workflow:update` merely for this disabled-only parity create because this operator neither updates nor enables the Workflow.

No customer Target Workflow mutation has been executed by this operator yet.

### AI Materialization Workflow — public step types ready, live apply blocked

Current Source status is enabled and the exact reviewed chain is:

```text
SetRecordTrigger
→ GenerateAiTextWithSkyLarkAction ×4
→ SetRecordAction
```

Public Lark Workflow schema covers the corresponding concepts:

```text
SetRecordTrigger
GenerateAiTextAction
SetRecordAction
```

It also documents trigger field outputs, trigger `startTime`, whole-output refs from `GenerateAiTextAction`, and SetRecordAction field/ref semantics.

Exact Source final update includes:

```text
generation_status = generated
failure_code       = null
generated_at       = trigger startTime
```

The remaining blocker is `failure_code = null`. Public `RecordFieldValue` requires `ValueInfo[]`, while the documented `ValueInfo` enum does not define a null/clear value for clearing a Text field. No reviewed official example/test proves that `null`, empty string or `[]` is the clear encoding. Omitting `failure_code` is also non-parity because an older failure value could remain.

Files:

- `scripts/lib/customer-base-ai-materialization-workflow-readiness.js`
- `scripts/customer-base-ai-materialization-workflow-readiness.mjs`
- `tests/scripts/customer-base-ai-materialization-workflow-readiness.test.js`
- `docs/project-brain/customer-base-ai-materialization-workflow-readiness-2026-08-21.md`

The readiness operator is intentionally local/read-only, exposes no Target client and rejects `--apply` unconditionally. Expected terminal state is:

`CUSTOMER_BASE_AI_WORKFLOW_DOCUMENTED_TYPES_READY_NULL_CLEAR_BLOCKED`

Do not create/update/enable the AI Materialization Workflow until a documented/proven Text-field clear semantic exists.

## No-repeat rules

1. Never create a new automatic-migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never rewrite the four Formula definitions.
5. Never rerun the passed Sort/Group runner.
6. Never rerun the passed Dynamic Date Filter mutation.
7. Never rerun Dashboard 66-block materialization.
8. Never retry Theme PATCH on the current generic-created Dashboard containers.
9. Never restore Width/RowHeight as parity requirements.
10. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
11. Never invent undocumented Slicer/Table View/Workflow payloads.
12. Never enable `Eligible AI Run → Lark Group Notification` during parity; current Source status is disabled.
13. Never create the AI Materialization Workflow while null-clear semantics are unresolved.
14. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Run focused Notification/placement/AI-readiness regression on the exact branch HEAD.
2. Run local AI Materialization readiness against the exact Source; expected zero remote requests/mutations and one exact null-clear blocker.
3. After the required Workflow permissions are active, run Notification Workflow read-only Target preview.
4. Run Branch Verification on the same exact HEAD.
5. If preview and CI pass, perform one controlled disabled-only Notification Workflow create/readback + folder move; never enable it.
6. Keep AI Materialization blocked until a documented/proven null-clear contract is available; otherwise close that one semantic through minimal supported UI/manual configuration rather than guessing API payloads.
7. Export Target once and run final parity verification.
8. Ready/Merge PR #661 only on explicit user instruction.
