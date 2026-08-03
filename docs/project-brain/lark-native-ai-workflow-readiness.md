# Project Brain — Lark Native AI Workflow Readiness

## Current verified phase

AI Preview, Notification Log schema, destination binding and fresh Workflow Readiness have passed on the live Integration Workspace.

```text
🧠 MKT_AI_Report_Runs       present / required fields ready
🔔 MKT_Notification_Log     zero_drift / 15 fields / 6 views
Social MKT Executive Reports exact chat resolved
⚙️ MKT_Report_Settings      66 integration rows / one matching destination
ai_enabled                  false for all integration rows
notification_enabled        false for all integration rows
workflow inventory          0
readiness blockers          0
Schedule                    disabled
Production                  blocked
```

Live evidence:

```text
Notification Log
outputs/lark-notification-log-schema/20260803T171919260Z-e37a98b24bc1-79714

Destination binding
outputs/lark-native-ai-destination-binding/20260803T182132508Z-18bb72741821-82088

Fresh zero-blocker Workflow Readiness
outputs/lark-native-ai-workflow-readiness/20260803T182338227Z-18bb72741821-82191
```

## Authorized next mutation

Create exactly two Lark Workflow identities as disabled shells:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Each shell must be created with `steps=[]`. This is intentional: Phase 6 locks exact identities without installing any latent Trigger, Native AI action, Record write or Message action. A later disabled-configuration workstream will review and update the Step definitions before any activation decision.

New Workflow creation may use only the create endpoint. The Operator may not call Workflow update, delete, enable or disable endpoints. Readback must prove one exact item per title, disabled/draft status and zero Steps.

## Safety boundary

- every `MKT_*_ENABLED` flag remains false;
- `ai_enabled` and `notification_enabled` remain false;
- maximum Workflow creates is two;
- Workflow update/status change is zero;
- Record writes and messages are zero;
- no Webhook, D1, Queue, Worker, Provider, Schedule or Production action occurs;
- raw Workflow, Chat, Record and Field identifiers are excluded from evidence.

A partial successful create is not retried automatically. The next explicit rerun starts from live Workflow inventory and creates only the exact missing shell. Existing configured, enabled, duplicate or unknown-status targets block before mutation.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
docs/tasks/lark-native-ai-disabled-workflows-v1.md
```
