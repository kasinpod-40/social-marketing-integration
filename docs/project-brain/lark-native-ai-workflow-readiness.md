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

Live evidence:

```text
outputs/lark-notification-log-schema/20260803T171919260Z-e37a98b24bc1-79714
```

The next phase is not Workflow activation. It is destination binding and disabled Workflow preparation after exact readiness passes.

## Target workflows

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Neither workflow may be enabled until exact live Table/Field/Notification Log metadata, existing Workflow inventory and destination identity have been inspected together.

## Destination authority

User-approved exact group name:

```text
Social MKT Executive Reports
```

`Social MKT Sync` is already present as a Group Bot in this group. The previous longer proposed name is no longer authoritative.

A rotated Incoming Webhook is not a `group_id` and is never stored in Base or evidence. Readiness resolves the exact Lark Chat visible to the App and compares only its SHA-256 identity with the Settings destination. Raw Chat IDs and webhook URLs are excluded from output.

## Safety boundary

The readiness terminal permits only metadata, bounded Settings Record, Workflow list/get and Chat list reads. It cannot create/update/delete a Workflow, change status, write Records, send a message, call a webhook, alter D1/Queue/Worker/Provider or enable Schedule/Production.

`ai_enabled`, `notification_enabled`, `notification_eligible`, `preview_mode` and `sent_to_group` remain unchanged.

## Failure semantics

A completed audit may return `status=blocked`. This is expected when Settings lacks a verified destination, permissions are missing, an existing target Workflow conflicts or schema has drifted. The next workstream fixes only the exact observed blocker; it does not add a parallel notification engine or bypass Lark Native Workflow.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
```
