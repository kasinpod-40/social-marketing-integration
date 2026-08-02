# Project Brain — Lark Native AI Schema Preview

## Current authority

`report_to_lark_ai_v1` uses the existing `🧠 MKT_AI_Report_Runs` table and existing `⚙️ MKT_Report_Settings`. No duplicate AI, Settings or destination table is allowed.

Phase 1 is repository-only and additive-only:

```text
23 AI readiness/evidence fields
2 Select option extension actions
6 logical Preview Views
31 total logical actions on audited Base 14
```

## Planner

```text
packages/config/src/lark-native-ai-schema-preview.js
scripts/lark-native-ai-schema-preview.mjs
```

Allowed input is a sanitized offline normalized Base inventory. The operator performs no Lark read or write.

Controlled outcomes:

```text
ready_to_apply  additive actions exist and no blocker exists
zero_drift      every required field/option/View already exists
blocked         exact table/field/options identity is unsafe
```

## Fail-closed rules

- exactly one `🧠 MKT_AI_Report_Runs` table;
- reuse fields must exist with compatible type;
- existing additive fields must have exact compatible type;
- Select options must be read back before extension planning;
- duplicate table, field or View names block;
- no rename, delete, option removal or field-type change;
- no automatic Apply path exists;
- `--apply` and `--execute` are rejected.

## Current main compatibility

Current main contains:

```text
Chatwoot Report readiness collector     merged
D1ChatwootReportSource runtime wiring   merged
Chatwoot sourceStatus                   uat_pending
Catalog promotion                       blocked
Live Report materialization             blocked
```

Runtime wiring is not validated Report evidence. AI may expose the readiness state but must not use Chatwoot business metrics until the Shared Report materialization passes its separate gates.

## Safety

```text
Remote Lark read/write       0 / 0
Lark Native AI call          0
Automation create            0
Notification send            0
Remote D1/Queue/Worker       0
Provider action              0
Production                   BLOCKED
```

## Next sequence

```text
merge repository Preview
→ reviewed Remote Lark read-only inventory
→ exact zero-conflict action evidence
→ separate approval for additive Lark Apply
→ read-back zero drift
→ Lark Native AI prompt binding without Automation
→ 40-row all-channel Preview
```
