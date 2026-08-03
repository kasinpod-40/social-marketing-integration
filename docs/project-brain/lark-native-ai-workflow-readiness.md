# Project Brain — Lark Native AI Workflow Readiness

## Current verified phase

AI Preview quality passed and the guarded Notification Log schema was applied successfully:

```text
🔔 MKT_Notification_Log
Fields                  15
Views                    6
Filtered Views           5
Records                   0
Blocked Remote requests  0
Automation               0
Notification/Webhook     0/0
Schedule                 disabled
Production               blocked
```

Live Notification Log evidence:

```text
outputs/lark-notification-log-schema/20260803T171919260Z-e37a98b24bc1-79714
```

Latest Workflow Readiness evidence resolved the exact group but found the Settings destination empty:

```text
attempt                  outputs/lark-native-ai-workflow-readiness/20260803T180814616Z-eb6aab4735b3-81569
status                   blocked
exactNameMatchCount      1
resolved                 true
integrationRowCount      66
distinctDestinationCount 0
blocker                   SETTINGS_GROUP_ID_MISSING
workflow inventory       0
planned disabled creates 2
```

## Target workflows

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Neither workflow may be created until destination binding and a fresh Workflow Readiness pass complete. Neither workflow may be enabled without separate authorization.

## Destination authority

User-approved exact group name:

```text
Social MKT Executive Reports
```

`Social MKT Sync` is already present as a Group Bot. The previous longer proposed name is no longer authoritative.

The exact Chat ID is resolved from the live chat inventory and belongs in the existing `group_id` Field of `⚙️ MKT_Report_Settings`. A rotated Incoming Webhook is not a `group_id` and is never stored in Base or evidence.

Destination binding may write only empty `group_id` values for exact `integration_workspace` rows. Raw Chat ID and Record IDs remain excluded from local output; verification uses SHA-256 only. Existing non-empty conflicting destinations fail closed and are never overwritten.

## Safety boundary

During binding:

- every `MKT_*_ENABLED` flag remains false;
- `ai_enabled` and `notification_enabled` remain false;
- no Workflow is created, updated or enabled;
- no message or Webhook is sent;
- no D1, Queue, Worker, Provider, Schedule or Production action occurs.

After binding, the existing Workflow Readiness must be rerun. Only an exact zero-blocker result may authorize a separate disabled-Workflow creation phase.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
```
