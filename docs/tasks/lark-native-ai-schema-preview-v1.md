# Lark Native AI Schema Preview v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_SCHEMA_PREVIEW_V1
BRANCH                             = implementation/lark-native-ai-schema-preview-v1
BASE_MAIN_SHA                      = 612e88ee4370b02350182452ef10a81eca01b5fd
CONTRACT_VERSION                   = lark_native_ai_schema_preview_v1
PARENT_CONTRACT                    = report_to_lark_ai_v1
PHASE                              = PHASE_1_ADDITIVE_SCHEMA_OPTIONS_PREVIEW
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
REMOTE_LARK_READ                   = 0
REMOTE_LARK_WRITE                  = 0
LARK_NATIVE_AI_CALL                = 0
LARK_AUTOMATION                    = 0
GROUP_NOTIFICATION                 = 0
REMOTE_D1_QUEUE_WORKER_PROVIDER    = 0
PRODUCTION                         = BLOCKED
```

## Objective

Prepare the exact additive-only Lark schema and View plan required before the 40-row all-channel AI Preview can be materialized.

This phase does not apply anything to Lark. It converts an offline normalized Base inventory into one deterministic plan that either:

```text
ready_to_apply
zero_drift
blocked
```

## Authority

The audited Base remains:

```text
Social MKT Data Hub(14).base
SHA-256          6dab2da7a8184d65c9e257747aa65ef3717f8d015b44214e199ddaebd165d128
Physical tables  72
Dashboards         6
Automations        0
```

Existing objects are reused:

```text
🧠 MKT_AI_Report_Runs
⚙️ MKT_Report_Settings
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

No replacement AI table, duplicate Settings table or destination table is introduced.

## Implementation

### Planner

```text
packages/config/src/lark-native-ai-schema-preview.js
```

The planner:

1. requires exactly one `🧠 MKT_AI_Report_Runs` table;
2. verifies the existing reusable AI output fields;
3. plans the 23 additive fields from `report_to_lark_ai_v1`;
4. plans additive Select options for `platforms` and `report_type`;
5. plans six Preview Views;
6. blocks duplicate table/field/View names;
7. blocks missing reusable fields and every type conflict;
8. blocks Select extension when exact current options cannot be read;
9. never plans rename, delete or field-type mutation;
10. is replayable to `zero_drift` after a simulated Apply.

### Offline operator

```text
scripts/lark-native-ai-schema-preview.mjs
```

Plan help:

```bash
node scripts/lark-native-ai-schema-preview.mjs
```

Build a plan from a sanitized offline inventory:

```bash
node scripts/lark-native-ai-schema-preview.mjs \
  --inventory <base-inventory.json> \
  --output <schema-preview.json>
```

`--apply` and `--execute` are intentionally rejected with:

```text
LARK_NATIVE_AI_SCHEMA_APPLY_NOT_AUTHORIZED
```

The optional output file is local evidence only and is written with mode `0600`.

## Exact audited-Base expectation

For the Base 14 schema described by the accepted audit:

```text
Add fields                23
Extend Select fields       2
Create Views               6
Total logical actions     31
Blockers                    0
Status                      ready_to_apply
Apply authorized            false
```

Select additions:

```text
platforms
- woocommerce
- chatwoot

report_type
- dashboard_channel_status
- dashboard_executive_summary
```

Views:

```text
🌐 All Channel Readiness
📊 Executive Summaries
⚠️ Missing / Partial Data
✅ Notification Eligible
❌ AI Generation Failures
🧪 Preview Runs
```

## View safety

Views are represented as logical contracts only. The Preview does not guess physical field IDs.

```text
All Channel Readiness    all rows
Executive Summaries      scope_type=executive
Missing / Partial Data   readiness in partial/missing/unavailable/failed states
Notification Eligible    notification_eligible=true AND preview_mode=false
AI Generation Failures   generation_status=failed
Preview Runs             preview_mode=true
```

The Notification Eligible View remains empty during Preview because every generated row is locked to:

```text
preview_mode=true
notification_eligible=false
sent_to_group=false
sent_at=null
```

## Chatwoot mainline compatibility

Current main now contains both the Chatwoot Report readiness collector and the PII-minimized `D1ChatwootReportSource` runtime registration in the Shared Dashboard Report registry.

The Report platform contract still remains `sourceStatus=uat_pending`. Catalog promotion and Live Report materialization are not authorized. Therefore:

```text
runtime reader registered           true
Catalog promoted                    false
Live Chatwoot Report materialized   false
AI validated Report evidence        absent until materialization passes
```

This schema phase adds only the approved `chatwoot` Select option. It does not use readiness evidence or runtime registration as a substitute for validated Report materialization.

## Regression coverage

```text
tests/application/lark-native-ai-schema-preview.test.js
```

Covered cases:

1. exact Base 14 plan is 23 fields + 2 option extensions + 6 Views;
2. simulated Apply followed by replay is `zero_drift`;
3. existing additive field with wrong type blocks;
4. duplicate target table blocks;
5. existing legacy options and Views are preserved;
6. unavailable Select options block instead of guessing.

## Definition of Done

- planner and operator exist;
- exact Base plan is deterministic;
- no destructive action can be emitted;
- replay reaches zero drift;
- `--apply` and `--execute` remain blocked;
- full Branch Verification passes on the exact Head;
- no current-task, Chatwoot recovery/readiness/runtime, Meta retained evidence, Report materializer or live config file changes;
- no Remote action occurs.

## Next gate

After merge, a separate exact-Head reviewed operator may perform:

```text
Remote Lark read-only inventory
→ compare with this contract
→ record exact action plan
→ explicit approval for additive Lark Apply
```

Live Lark Apply, Lark Native AI prompt binding, 40-row Lark write, Notification Log and disabled Automations remain separate phases.
