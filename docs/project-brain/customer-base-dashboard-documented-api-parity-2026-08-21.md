# Customer Base Dashboard Documented API Parity — 2026-08-21

## Decision

The previous manual-only Dashboard assumption is superseded. The BNK project already proved customer-owned Lark Base Dashboard creation through Base v3 API, and current official Lark CLI Dashboard documentation confirms the same write/readback contract.

This recovery reuses that proven Base v3 path through the existing MKT `LarkBitableClient.requestBitableJson()` transport. It does not create another HTTP client, clone engine, migration wrapper, checkpoint, Worker path, Queue path, or deployment path.

## Current Source authority

```text
file            Social MKT Data Hub.base
sha256          9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
Dashboards      6
blocks          75
Workflows       2
```

Dashboard order:

1. `💬 Customer Service & Leads` — 11
2. `🛡️ Data Quality & Operations` — 8
3. `📊 Executive Marketing Overview` — 11
4. `🌱 Organic Performance` — 22
5. `💰 Paid Ads Performance` — 13
6. `🛒 Commerce & Conversion` — 10

All Dashboard + Chart snapshots were proven Base64 → UTF-8 JSON. The safe semantic manifest produced:

```text
mapped Table refs            120
mapped Field refs            313
mapped Select-option refs    106
parsed JSON strings          160
opaque strings               0
remote mutations             0
```

Table View mapping was also resolved read-only:

- `🔄 Latest Sync Runs` → `🔄 MKT_Sync_Log` → `📊 Dashboard Sync Health`
- `🚨 Recent System Alerts` → `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts`

## Proven Base v3 write contract

BNK precedent: `kasinpod-40/bnk-business-management` PR #3, operator `scripts/bnk/apply-sales-orders-dashboard.mjs`.

Retained endpoint pattern:

```text
GET   /open-apis/base/v3/bases/{base}/dashboards
POST  /open-apis/base/v3/bases/{base}/blocks
GET   /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}/blocks
POST  /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}/blocks
GET   /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}/blocks/{block_id}
PATCH /open-apis/base/v3/bases/{base}/dashboards/{dashboard_id}
```

Dashboard navigation block creation supports `parent_id`, so the six customer Dashboards can be created directly under `Setup Phase | Social MKT Data Hub` without staging elsewhere.

Official Lark CLI Dashboard SSOT additionally confirms:

- `data_config` uses semantic `table_name` / `field_name`;
- supported block types include `statistics`, `text`, `column`, `bar`, `line`, `pie`, `ring`, `area`, `combo`, `scatter`, `funnel`, `wordCloud`, `radar`;
- exact component layout accepts top-level `position {x,y,w,h}` on a 12-column grid;
- `statistics.data_config.number_format` supports `digital`, `digital_without_separator`, `percentage_rounded`, `cyn_rounded`, `dollar_rounded` plus optional precision 0..9.

## Current Source block-kind boundary

The exact Source contains only these five chart kinds:

```text
statistics     39   documented
text           18   documented
column          9   documented
slicer          7   not in public Dashboard block enum
table_view      2   not in public Dashboard block enum
TOTAL          75
```

Therefore:

```text
documented API scope     66
unsupported remainder     9
```

Do not send guessed raw `slicer` or `table_view` block types to the customer Target. A missing public enum is not permission to replay internal snapshot schema.

## Operator

Files:

- `scripts/lib/customer-base-dashboard-parity.js`
- `scripts/customer-base-dashboard-parity.mjs`
- `tests/scripts/customer-base-dashboard-parity.test.js`

The planner:

- decodes current Source snapshots locally;
- matches each exported Chart to its layout widget through Source chart identity/token;
- maps Source Table/Field/View/Select-option IDs to semantic names locally;
- converts `COUNTA`, series rollups, group-by, sort, filters and statistics number formats to the documented Base v3 contract;
- converts exported Rich Text payloads to API text blocks without replaying internal IDs/tokens;
- carries exact Source `x/y/w/h` into documented Dashboard block `position`;
- identifies Slicer/Table View as explicit unsupported remainder;
- requires the exact reviewed totals `6 / 75 / 66 / 9`.

The live operator:

- default mode is preview/read-only;
- requires the exact current Source SHA;
- verifies immutable customer Target anchor Tables;
- resolves `Setup Phase | Social MKT Data Hub` exactly once;
- creates missing Dashboards only inside that folder;
- applies `summerBreeze` theme through documented Dashboard update;
- creates supported blocks sequentially with `rate_limit_only` retry;
- reads back each created/existing block;
- duplicate names, unknown Target blocks, type/data_config/position conflicts fail closed;
- contains no delete path;
- reports Table/Field/Record/View/Formula/Role/Workflow mutation counts as zero.

Exact Apply confirmation:

```text
APPLY_CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_PARITY_V1
```

## No-repeat / safety

- Automatic migration remains closed; never rerun it.
- Original migration checkpoint remains immutable; never regenerate it.
- Sort/Group live PASS remains closed; never rerun it.
- Dynamic Date Filter live PASS remains closed; never rerun it.
- Formula definitions must never be rewritten during Dashboard work.
- Do not mutate Source, Worker, D1, Queue, schedules or deployments.
- Do not use raw internal Dashboard snapshots as OpenAPI payloads.
- Do not guess Slicer/Table View write contracts.
- PR #661 remains Draft/Open/Unmerged until final explicit authorization.
