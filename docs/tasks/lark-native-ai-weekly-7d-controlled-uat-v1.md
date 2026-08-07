# Lark Native AI Weekly 7D Controlled UAT v1

## Objective

Prepare one isolated Executive 7D AI Run from the latest available validated Report evidence already present in the Integration Workspace Lark Base, then hand that exact row to the existing inactive Lark Native AI Automation for manual `Test Results` quality review.

This phase exists only to inspect the Prompt v2 output before Notification Admission or weekly Schedule activation.

## Locked business behavior

The target report is the 7D Executive weekly summary.

AI must receive and prioritize:

- current validated business metrics;
- previous 7D comparison when the Report contains it;
- Top Content;
- Top Ads;
- dimensional Commerce / Customer Service evidence reconstructed from validated Metric rows;
- all nine expected business channels.

Channels without aligned evidence remain visible but must later be rendered by Prompt v2 as natural Thai such as `ยังไม่พบข้อมูลสำหรับช่วงนี้` rather than internal status vocabulary.

## Selection policy

The operator reads only existing Lark Report output tables and chooses:

```text
newest 7D period with maximum channel coverage
```

It never mixes different reporting periods inside one Executive AI Run. A channel without a validated Report for the selected exact period is treated as missing for that weekly UAT period.

## UAT identity isolation

The UAT uses a dedicated template identity:

```text
weekly_executive_quality_v2_uat
```

Therefore it does not overwrite the retained 40-row Controlled Preview generation or any sent Notification identity.

Exactly one `🧠 MKT_AI_Report_Runs` row may be created or safely updated:

```text
scope_type             executive
window_days            7
preview_mode           true
notification_eligible  false
sent_to_group          false
generation_status      pending
template_version       weekly_executive_quality_v2_uat
```

No delete authority exists.

## Existing Automation authority

Reuse exactly these existing inactive Base UI Automations, proven by Bitable v1 identity hashes:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Both must still resolve to their reviewed identity SHA-256 values and inactive state before the UAT row may be written.

The numeric Bitable v1 Automation identity is not replaced with a Base v3 `wkf...` Workflow. No duplicate Automation may be created.

## Lark UI configuration package

Because the existing numeric Base UI Automation definition is not exposed through the proven Base v3 Workflow mutation surface, the Terminal retains a private `lark-ui-configuration.md` containing:

- exact Prompt v2 version and package hash;
- four `AI-generated text (GPT model)` actions;
- reference field bindings;
- target output fields;
- final Update-record bindings;
- forbidden activation/notification actions.

The required AI actions target:

```text
insight_summary
strengths
weaknesses
recommendations
```

Each prompt must bind its `{{field_name}}` semantic placeholder to the current trigger record's Lark rich-reference token for that same field.

After the four AI actions, one Update-record action writes the four results to the current AI Run and sets:

```text
generation_status = generated
failure_code       = empty
generated_at       = automation_now
```

## Controlled Terminal

After merge:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT=RUN_LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_V1 \
node scripts/lark-native-ai-weekly-7d-controlled-uat-terminal.mjs --execute
```

The Terminal:

1. requires clean exact current `main`;
2. validates Integration Workspace credentials;
3. verifies the two existing Automations remain exact and inactive;
4. reads Report Settings and validated 7D Report outputs only;
5. selects the exact aligned weekly period;
6. builds business-first Executive evidence using the existing AI Preview builder and Prompt v2 contract;
7. creates or safely updates at most one isolated Executive UAT row;
8. verifies exact readback;
9. emits a private UI configuration package;
10. stops before any Native AI execution or notification.

## Remote boundary

Allowed:

```text
POST tenant_access_token
GET  Base tables
GET  bounded Report Settings records
POST bounded Report/AI record searches
GET  Bitable v1 List automations
POST at most one MKT_AI_Report_Runs batch_create OR batch_update
```

Forbidden:

- Report materialization;
- Source connector action;
- Remote D1 / Queue / Worker action;
- Automation create/update/enable/disable;
- Lark message send;
- Notification Admission;
- Schedule activation;
- Production.

## Definition of Done for this phase

Repository phase:

- focused application and Terminal tests pass;
- full Unit/Workers regression passes;
- Report reliability passes;
- dependency audit and Wrangler dry-run pass;
- exact Head Branch Verification passes.

Live preparation phase:

- exact inactive Automation authority remains valid;
- one 7D UAT row is retained and read back exactly;
- Prompt v2 UI package is retained;
- AI calls remain 0;
- Notification sends remain 0;
- Schedule remains disabled.

AI quality is not considered passed until the existing inactive Automation runs `Test Results` on the prepared row and the generated Thai text is reviewed.
