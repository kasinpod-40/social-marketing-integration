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

Live evidence:

```text
outputs/lark-notification-log-schema/20260803T171919260Z-e37a98b24bc1-79714
outputs/lark-native-ai-destination-binding/20260803T182132508Z-18bb72741821-82088
outputs/lark-native-ai-workflow-readiness/20260803T182338227Z-18bb72741821-82191
```

## Live Automation authority

Because the app lacked `base:workflow:create` and the Base UI would not save empty Workflows, the user created the two exact identities manually as inactive placeholders:

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

Exact accepted placeholder shape:

```text
one AddRecordTrigger on the approved table
→ one Delay action for 1 minute
→ no other Step or action
```

Trigger tables:

```text
AI Materialization → MKT_AI_Report_Runs       🧾 MKT_Report_Snapshots
Eligible AI Run → Lark Group Notification    🧠 MKT_AI_Report_Runs
```

The previous empty `steps=[]` proposal is historical and is no longer the current live authority. UI-generated Step IDs are not stable; semantic shape, exact table, one-minute delay and inactive status are authoritative.

## Safety boundary

- every `MKT_*_ENABLED` flag remains false;
- `ai_enabled` and `notification_enabled` remain false;
- Workflow update/status change is zero;
- Native AI execution is zero;
- Record writes and messages are zero;
- no Webhook, D1, Queue, Worker, Provider, Schedule or Production action occurs;
- raw Workflow, Chat, Record and Field identifiers are excluded from evidence.

## Remaining permission bundle

All remaining Workflow API permissions must be disclosed together before a new approval request:

```text
base:workflow:read
base:workflow:create
base:workflow:update
base:workflow:write
```

`base:workflow:delete` is not part of the current plan. Current inactive-placeholder reconciliation uses only read access and must produce `workflowCreateCount=0`.

## Next phase

1. Run exact read-only semantic reconciliation of the two inactive placeholders.
2. Prepare the complete disabled Workflow Step mapping and notification payload Preview in Repository only.
3. Do not update, enable or test-send either Automation until the full mapping and complete permission bundle are reviewed together.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
docs/tasks/lark-native-ai-disabled-workflows-v1.md
```
