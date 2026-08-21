# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = DASHBOARD_DOCUMENTED_API_PREVIEW_PENDING
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
CLONE_TABLES                        = 32
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
CURRENT_SOURCE_RECORDS              = 36552
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
DASHBOARDS                          = API_PLAN_6_DASHBOARDS_75_BLOCKS_66_DOCUMENTED_9_REMAINDER
WORKFLOWS                           = MANUAL_RECONSTRUCTION_PENDING_2
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_DASHBOARD_WORKFLOW_FINAL_EXPORT
```

## Objective

Close remaining customer-owned Lark Base parity without reopening successful migration state. Reuse existing shared clients/operators and previously proven API contracts. Do not mutate Source, Worker, D1, Queue, schedules, deployment, or the retained automatic-migration checkpoint.

## Closed — never rerun

The controlled automatic migration is closed. Final canonical GET verification passed with mismatch count `0` across the clone scope. The original checkpoint is immutable and must never be recreated.

Closed state includes:

- 32 clone Tables and all migration-owned Fields/Records;
- Relations and Formula definitions;
- supported View filters/hierarchy and hidden fields;
- Advanced Permission parity covered by the controlled migration;
- protected `🎵 RAW_TikTok_Creator_Videos` remains zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete;
- View Sort 42 / Group 4 live write+readback PASS;
- Formula presentation 4/4 complete in UI without Formula-expression mutation;
- `📈 MKT_Ads_Daily → 📈 Google Ads Daily 30D` dynamic filter live PASS with exact `platform is google_ads AND metric_date is TheLastMonth`.

Do not run automatic Apply, Sort/Group, Formula presentation or Dynamic Date Filter again unless a later read-only audit proves drift.

## Cosmetic View dimensions

By explicit user decision, historical Column Width and Row Height were incidental presentation changes and are removed from parity gates. Field order and frozen columns remain presentation-only observations because no documented setter has been proven.

```text
Column Width                  ignored cosmetic
Row Height                    ignored cosmetic
Field order mismatches        105 Views
Frozen columns                110 Views
```

Do not invent undocumented setters.

## Dashboard authority — current exact Source

Current Source authority is `Social MKT Data Hub.base` SHA-256:

```text
9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
```

The current Source contains exactly six Dashboards / 75 blocks:

1. `💬 Customer Service & Leads` — 11
2. `🛡️ Data Quality & Operations` — 8
3. `📊 Executive Marketing Overview` — 11
4. `🌱 Organic Performance` — 22
5. `💰 Paid Ads Performance` — 13
6. `🛒 Commerce & Conversion` — 10

All 81 Dashboard/Chart snapshots were proven to be Base64 → UTF-8 JSON. The semantic decode mapped Table/Field/Select-option references to names and found zero opaque snapshot payloads. The two Table View widgets were separately resolved to:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

## Dashboard API correction — BNK reuse

The earlier assumption that all 75 Dashboard blocks required manual UI reconstruction was wrong and is superseded.

The existing BNK project proved the Base v3 Dashboard write path in `scripts/bnk/apply-sales-orders-dashboard.mjs`:

- list Dashboards: `GET /open-apis/base/v3/bases/{base}/dashboards`
- create Dashboard navigation block in a folder: `POST /open-apis/base/v3/bases/{base}/blocks`
- list Dashboard blocks: `GET /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}/blocks`
- create Dashboard block: `POST /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}/blocks`
- exact block placement: top-level `position {x,y,w,h}` in the 12-column grid
- Dashboard theme update: `PATCH /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}`
- Dashboard/block readback through the corresponding GET endpoints

Lark CLI official Dashboard SSOT confirms documented block types `statistics`, `text`, `column`, `bar`, `line`, `pie`, `ring`, `area`, `combo`, `scatter`, `funnel`, `wordCloud`, `radar`, with semantic `data_config` based on Table/Field names and optional exact `position`.

Current Source chart-kind inventory is:

```text
statistics     39
a text          18
column           9
slicer           7
table_view       2
TOTAL            75
```

Therefore the reviewed documented-API boundary is:

```text
Documented API blocks        66 / 75
Unsupported public enum       9 / 75
  slicer                       7
  table_view                   2
```

Do not send guessed undocumented `slicer` or `table_view` block types to the customer Target. Those 9 remain explicit remainder until a documented/proven contract is found.

## Dashboard operator

New narrow post-Apply operator:

```text
scripts/customer-base-dashboard-parity.mjs
scripts/lib/customer-base-dashboard-parity.js
```

This is not a clone/migration engine. It reuses `LarkBitableClient.requestBitableJson()` for authentication, throttling and retry behavior and performs only Dashboard/navigation-block mutations.

Safety gates:

1. exact current Source SHA only;
2. exact six Dashboard names/counts;
3. exact current reviewed boundary `75 total / 66 documented API / 9 unsupported`;
4. maps Source IDs locally to semantic Table/Field/View/Select-option names before request construction;
5. validates all Source positions against the documented 12-column grid;
6. requires all four immutable Target identity-anchor Tables;
7. resolves target folder `Setup Phase | Social MKT Data Hub` exactly once;
8. duplicate Dashboard/block names fail closed;
9. unknown existing Target block names fail closed;
10. existing block type/data_config/position conflicts fail closed;
11. creates missing blocks sequentially using rate-limit-only retry and readback;
12. no delete scope;
13. no Table/Field/Record/View/Formula/Role/Workflow mutation;
14. exact Apply confirmation required.

Apply confirmation:

```text
APPLY_CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_PARITY_V1
```

Expected successful documented-API status after live apply:

```text
DASHBOARD_DOCUMENTED_API_PASS_WITH_UNSUPPORTED_REMAINDER
```

with documented API mismatch `0` and explicit remainder `7 slicers + 2 table views`.

## Workflows

Two Source Workflows remain separate from Dashboard closure:

1. `AI Materialization → MKT_AI_Report_Runs`
2. `Eligible AI Run → Lark Group Notification`

Do not replay raw Draft/FlowSchema/auth/generated IDs. Preserve Source intended enabled/disabled state and reconstruct only through a documented/proven definition-write contract or supported UI.

## No-repeat rules

1. Never create a new automatic-migration checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never rewrite the four Formula definitions.
5. Never rerun the passed Sort/Group runner.
6. Never rerun the passed Dynamic Date Filter mutation.
7. Never restore Width/RowHeight as parity requirements.
8. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
9. Never invent undocumented Slicer/Table View/Workflow write payloads.
10. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Run focused Dashboard regression tests on the exact branch HEAD.
2. Run Dashboard operator in default preview/read-only mode against exact Source + customer Target; require six Dashboards, 75 Source blocks, 66 documented-API planned blocks, 9 explicit unsupported remainder, and zero Target mutation.
3. Require Branch Verification SUCCESS on that same exact HEAD.
4. Only then run one controlled Dashboard `--apply` using exact confirmation.
5. Read back all six Dashboards and all 66 documented-API blocks; require documented mismatch `0`.
6. Close the 7 Slicer + 2 Table View remainder only through a proven documented contract or minimal supported UI.
7. Close Workflow 2.
8. Export Target once and run final parity verification.
9. Ready/Merge PR #661 only on explicit user instruction.
