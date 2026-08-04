# Project Brain — Lark Native AI Workflow Readiness

## Current verified phase

AI Preview, Notification Log schema, exact destination binding and zero-blocker Workflow Readiness passed on the Integration Workspace.

```text
🧠 MKT_AI_Report_Runs       present / required fields ready
🔔 MKT_Notification_Log     zero_drift / 15 fields / 6 views
Social MKT Executive Reports exact chat resolved
⚙️ MKT_Report_Settings      66 integration rows / one matching destination
ai_enabled                  false for all integration rows
notification_enabled        false for all integration rows
Schedule                    disabled
Production                  blocked
```

## Live UI Automation authority

The user created the two exact Automations manually in Lark Base:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Current UI state:

```text
Automation total  2
Active            0
Inactive          2
```

Each still has exactly one new-record Trigger and one one-minute Delay. There is no Record write or Message action.

## API inventory boundary

The current Base List Workflows call returns zero items even while the UI shows the two inactive Automations. Therefore zero Workflow inventory is not evidence that the UI Automations are missing.

Successful read-only reconciliation evidence:

```text
main                          da502ebb0f2348edd2b120891a509d0da89393f4
status                        manual_ui_automations_locked_api_workflow_inventory_empty
mode                          read_only_reconciliation
UI Automations                2
Active / Inactive             0 / 2
Workflow List inventory       0
Workflow create/update        0 / 0
Workflow status change        0
Notification                  0
Schedule                      disabled
Production                    BLOCKED
```

The corrected reconciliation operator has no Workflow create, update, enable, disable, delete, Record write or Message route.

## Verified Custom AI field authority

User-confirmed Lark Base UI screenshots on 2026-08-04 prove that these four columns in `🧠 MKT_AI_Report_Runs` are already separate `Custom AI field` outputs exported as Text:

```text
insight_summary
strengths
weaknesses
recommendations
```

Each field writes itself directly and has a Thai prompt for the current record. Visible prompt references are:

```text
scope_type
channel_key
window_days
data_status
readiness_status
readiness_message
```

This resolves the earlier `LARK_NATIVE_AI_OUTPUT_BINDING_UNPROVEN` blocker. The full prompt tail and exact automatic generation policy were not visible, so auto-generation for future records remains unproven.

## Corrected disabled configuration authority

The final AI Automation must not add another Native AI generation action. The four Custom AI fields are the generation layer.

Corrected architecture:

```text
Central Report Metrics
→ 🧠 MKT_AI_Report_Runs source fields
→ four Lark Custom AI fields
→ Automation waits until all four outputs are populated
→ Automation marks generation_status=generated
→ executive-only notification eligibility
→ exact Snapshot
→ exact enabled Report Settings destination
→ Notification Log dedupe
→ one Lark group message
→ sent-state updates
```

Workflow 1 final Trigger moves to pending non-preview rows in `🧠 MKT_AI_Report_Runs` only after all four Custom AI fields are non-empty. Its only action is to set `generation_status=generated`, clear `failure_code` and set `generated_at`. It never runs a second AI action and never sends a message.

Workflow 2 accepts only executive, generated, eligible, non-preview and unsent rows. It resolves Snapshot before Settings, checks one Notification Log attempt identity, logs pending, sends once, then records sent state.

The approved destination remains:

```text
name  Social MKT Executive Reports
hash  7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9
```

Raw destination IDs, Webhook URLs and credentials remain forbidden from evidence.

## Current blockers before Live configuration

```text
LARK_CUSTOM_AI_AUTOGENERATION_POLICY_UNPROVEN
LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
```

The empty Workflow List API inventory remains an advisory:

```text
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
```

Manual UI editing is the confirmed path unless an exact API identity is later proven. No Live Automation edit, activation or test send is authorized while either blocker remains.

## Complete remaining permission bundle

Before any future API mutation, disclose the complete remaining bundle together:

```text
base:workflow:read
base:workflow:create
base:workflow:update
base:workflow:write
```

`base:workflow:delete` is not part of the current plan. The Repository Preview requests no new permission.

## Safety boundary

- every `MKT_*_ENABLED` flag remains false;
- `ai_enabled` and `notification_enabled` remain false;
- Workflow create/update/status change is zero;
- Native AI execution is zero;
- Record writes and messages are zero;
- no Webhook, D1, Queue, Worker, Provider, Schedule or Production action occurs;
- raw Workflow, Chat, Record and Field identifiers are excluded from evidence.

## Next phase

1. Merge and rerun the offline v2 Preview.
2. Capture the exact Custom AI automatic generation policy without generating or changing records.
3. Prove or replace the Notification payload SHA-256 step before any notification workflow configuration.
4. Keep both Automations inactive; do not test-send or activate.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
docs/tasks/lark-native-ai-disabled-workflows-v1.md
docs/tasks/lark-native-ai-disabled-configuration-preview-v1.md
```
