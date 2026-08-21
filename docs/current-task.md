# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = DASHBOARD_THEME_PREVIEW_AND_CI_PENDING
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
DASHBOARD_DOCUMENTED_BLOCKS         = LIVE_PASS_66_OF_66
DASHBOARD_UNSUPPORTED_REMAINDER     = 7_SLICER_PLUS_2_TABLE_VIEW
DASHBOARD_THEME                     = SUMMER_BREEZE_PENDING_SEPARATE_PHASE
WORKFLOWS                           = RECONSTRUCTION_PENDING_2
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_DASHBOARD_REMAINDER_WORKFLOWS_FINAL_EXPORT
```

## Closed — never rerun

The following stages are closed and must not be repeated unless a later read-only audit proves drift:

- controlled automatic migration / retained checkpoint;
- canonical parity mismatch `0`;
- protected `🎵 RAW_TikTok_Creator_Videos` zero-write;
- View hidden parity;
- View Sort `42/42` and Group `4/4` live PASS;
- Formula definitions and Formula presentation `4/4`;
- dynamic `📈 Google Ads Daily 30D` filter live PASS;
- Dashboard documented API materialization `66/66` blocks.

Never run `--prepare-checkpoint` again. Never rerun automatic Apply, Sort/Group, Formula presentation, Dynamic Date Filter, or the 66-block Dashboard materialization.

## Dashboard live authority

Current Source authority remains:

```text
Social MKT Data Hub.base
SHA-256 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
6 Dashboards / 75 total widgets
```

Live Target now contains all six Dashboard navigation blocks and all 66 documented API widgets:

```text
💬 Customer Service & Leads       10 documented + 1 slicer remainder
🛡️ Data Quality & Operations       6 documented + 2 table_view remainder
📊 Executive Marketing Overview   10 documented + 1 slicer remainder
🌱 Organic Performance             20 documented + 2 slicer remainder
💰 Paid Ads Performance            11 documented + 2 slicer remainder
🛒 Commerce & Conversion            9 documented + 1 slicer remainder
TOTAL                               66 documented + 9 remainder
```

Live resumable apply terminal status:

```text
DASHBOARD_DOCUMENTED_API_BLOCKS_PASS_WITH_UNSUPPORTED_REMAINDER
```

Readback mismatch for documented blocks = `0`.

Branch Verification for the materialization head:

```text
HEAD e40b23083126d8f6c8937683762985f5be73a486
Run  32480035425
Job  96764194928
SUCCESS all gates
```

The first Dashboard `💬 Customer Service & Leads` had been created by an earlier interrupted run and was reused without duplication. Five additional Dashboards and 66 documented blocks were created in the successful resume. No Table, Field, Record, View, Formula, Role or Workflow mutation occurred.

## Dashboard remainder

Nine Source widgets are not in the current public Dashboard block enum:

```text
slicer       7
table_view   2
```

Exact Table View semantic mapping:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

Do not replay internal snapshot block types or invent undocumented payloads. Current Base JS SDK exposes UI navigation such as `switchBlock` but no documented Dashboard component creation API, so these nine remain fail-closed until a proven supported contract is found or a minimal supported UI path is explicitly accepted.

## Dashboard theme parity

Source theme authority is:

```text
summerBreeze
```

Official Lark Base v3 Dashboard update contract supports:

```text
PATCH /open-apis/base/v3/bases/{base_token}/dashboards/{dashboard_id}
body = {"theme":{"theme_style":"summerBreeze"}}
scope = base:dashboard:update
```

Theme parity is deliberately separated from the already-closed 66-block materialization.

New narrow phase:

```text
scripts/lib/customer-base-dashboard-theme-parity.js
scripts/customer-base-dashboard-theme-parity.mjs
tests/scripts/customer-base-dashboard-theme-parity.test.js
```

Safety behavior:

1. preview/read-only first;
2. resolve all six Dashboard names exactly once;
3. require all six remain under `Setup Phase | Social MKT Data Hub`;
4. require documented block counts `10/6/10/20/11/9` before any theme write;
5. Apply requires exact confirmation `APPLY_CUSTOMER_BASE_DASHBOARD_THEME_PARITY_V1`;
6. PATCH one Dashboard at a time;
7. verify expected `summerBreeze` through PATCH response echo;
8. on failure report exact Dashboard stage plus completed ledger for safe resume;
9. zero Dashboard-block/Table/Field/Record/View/Formula/Role/Workflow mutation;
10. no delete path.

## Workflows

Two Source Workflows remain separate:

1. `AI Materialization → MKT_AI_Report_Runs`
2. `Eligible AI Run → Lark Group Notification`

Do not replay raw Draft/FlowSchema/auth/generated IDs. Preserve intended enabled/disabled state and reconstruct only through a documented/proven definition-write contract or supported UI.

## Required next sequence

1. run focused theme regression tests on current exact branch HEAD;
2. run theme operator preview/read-only; require six Dashboards and 66 documented blocks unchanged;
3. require Branch Verification SUCCESS on that same exact HEAD;
4. run one resumable Theme Apply; require `DASHBOARD_THEME_PASS` and six response echoes = `summerBreeze`;
5. close the 7 Slicer + 2 Table View remainder only through a proven supported path;
6. close Workflow 2;
7. export Target once and run final parity verification;
8. Ready/Merge PR #661 only after explicit user instruction.
