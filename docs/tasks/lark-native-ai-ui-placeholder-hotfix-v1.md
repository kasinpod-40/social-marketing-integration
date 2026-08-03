# Lark Native AI UI Placeholder Reconciliation Hotfix v1

## Objective

Promote the two user-created inactive Lark Automations to the exact live authority and reconcile them semantically without requiring `base:workflow:create`.

## Live state

```text
AI Materialization → MKT_AI_Report_Runs       inactive
Eligible AI Run → Lark Group Notification    inactive
Active                                         0
Inactive                                       2
```

Each Automation contains only one new-record Trigger and one one-minute Delay.

## Contract correction

The earlier empty `steps=[]` API shell is historical. Current exact accepted shape is:

- `AddRecordTrigger` on the approved table;
- `Delay` for exactly one minute;
- direct Trigger-to-Delay edge;
- no other Step;
- disabled/inactive/off/draft status.

UI-generated Step IDs are ignored. Wrong table, wrong delay, extra action, duplicate title or enabled status blocks.

## Safety

Repository and CI perform no Lark request. Current live reconciliation is expected to call only Workflow list/get and return `workflowCreateCount=0`. No Workflow update/status change, Native AI execution, Record write, message, Webhook, D1, Queue, Worker, Schedule or Production action is authorized.

## Verification

```bash
npm ci
npm run check
node --test tests/scripts/lark-native-ai-disabled-workflows.test.js
node --test tests/scripts/lark-native-ai-disabled-workflows-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
