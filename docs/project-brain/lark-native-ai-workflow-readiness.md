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

Each has exactly one new-record Trigger and one one-minute Delay. There is no Native AI, Record write or Message action.

## API inventory boundary

The current Base List Workflows call returns zero items even while the UI shows the two inactive Automations. Lark documents List automations and List Workflows as separate read APIs under `base:workflow:read`; therefore zero Workflow inventory is not evidence that the UI Automations are missing.

Incident evidence from 2026-08-04:

```text
workflowListRead            2
workflowGetRead             0
workflowCreate              0
recordWriteCount            0
workflowUpdateCount         0
workflowStatusChangeCount   0
notificationCount           0
scheduleEnabled             false
production                  BLOCKED
```

The old operator attempted to enter the missing-Workflow path but stopped locally before any HTTP create request. No Remote mutation occurred.

## Corrected operator authority

`scripts/lark-native-ai-disabled-workflows-terminal.mjs` is read-only and delegates to the existing Workflow Readiness audit. It requires the current exact API boundary and emits:

```text
status  manual_ui_automations_locked_api_workflow_inventory_empty
mode    read_only_reconciliation
```

It has no Workflow create, update, enable, disable, delete, Record write or Message route.

## Safety boundary

- every `MKT_*_ENABLED` flag remains false;
- `ai_enabled` and `notification_enabled` remain false;
- Workflow create/update/status change is zero;
- Native AI execution is zero;
- Record writes and messages are zero;
- no Webhook, D1, Queue, Worker, Provider, Schedule or Production action occurs;
- raw Workflow, Chat, Record and Field identifiers are excluded from evidence.

## Complete remaining permission bundle

Before any future API mutation, disclose the complete remaining bundle together:

```text
base:workflow:read
base:workflow:create
base:workflow:update
base:workflow:write
```

`base:workflow:delete` is not part of the current plan.

## Next phase

1. Record the read-only UI/API boundary.
2. Prepare the complete disabled Workflow Step mapping and notification payload Preview in Repository only.
3. Do not update, enable or test-send either Automation until the full mapping and complete permission bundle are reviewed together.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
docs/tasks/lark-native-ai-disabled-workflows-v1.md
```
