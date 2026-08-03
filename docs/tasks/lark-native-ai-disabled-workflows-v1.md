# Lark Native AI Inactive UI Automations v1

## Current live state

The two exact Automations were created manually in the Lark Base UI and remain inactive:

```text
AI Materialization → MKT_AI_Report_Runs       inactive
Eligible AI Run → Lark Group Notification    inactive
Active automation count                       0
Inactive automation count                     2
```

Each Automation contains only:

```text
When a new record is added → Delay 1 minute
```

Trigger tables:

```text
AI Materialization → MKT_AI_Report_Runs       🧾 MKT_Report_Snapshots
Eligible AI Run → Lark Group Notification    🧠 MKT_AI_Report_Runs
```

There is no Native AI action, Record write, message action, Webhook, Schedule or activation.

## 2026-08-04 reconciliation incident

The previous reconciliation operator called the Base **List Workflows** API. That inventory returned zero items even though the Lark UI showed the two inactive Automations. The operator then entered its missing-Workflow create path, but stopped locally before any HTTP create request because the UI placeholders contain two Steps and the old create validator accepted only `steps=[]`.

Observed safe result:

```text
stage                       create-and-verify-disabled-shells
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

No Remote mutation occurred.

## API boundary

Lark exposes **List automations** and **List Workflows** as separate read APIs under `base:workflow:read`. The current repository integration calls only List Workflows. Therefore, a zero Workflow inventory must not be interpreted as permission to recreate UI Automations.

The user-confirmed UI state is the current authority until a separately reviewed List automations integration is available.

## Corrected operator behavior

`scripts/lark-native-ai-disabled-workflows-terminal.mjs` is now read-only:

1. runs the existing exact Workflow Readiness operator;
2. requires destination/settings/schema readiness to remain clean;
3. requires the current List Workflows inventory boundary to remain exactly zero;
4. records that the UI Automations are not exposed by the current Workflow List call;
5. performs no create, update, enable, disable or delete request.

Expected result:

```text
status                       manual_ui_automations_locked_api_workflow_inventory_empty
mode                         read_only_reconciliation
workflowCreateCount          0
workflowUpdateCount          0
workflowStatusChangeCount    0
automationEnabled            false
notificationCount            0
scheduleEnabled              false
production                   BLOCKED
```

## Exact Terminal after merge

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git pull --ff-only origin main && \
MKT_CONNECTOR_TIKTOK_ENABLED=false \
MKT_YOUTUBE_ANALYTICS_ENABLED=false \
CONFIRM_LARK_NATIVE_AI_DISABLED_WORKFLOWS=CREATE_LARK_NATIVE_AI_DISABLED_WORKFLOWS_V1 \
node scripts/lark-native-ai-disabled-workflows-terminal.mjs --execute
```

This command requires only the already-approved read permissions. It has no Workflow create route.

## Complete remaining permission bundle

Before any future API mutation, disclose and approve the complete remaining bundle together:

```text
base:workflow:read     inspect List automations / List Workflows / Get
base:workflow:create   create only if a reviewed missing identity genuinely exists
base:workflow:update   install or replace disabled Steps
base:workflow:write    status change in a separately authorized activation phase
base:workflow:delete   not required by the current plan
```

## Safety boundary

```text
Workflow create          0
Workflow update          0
Workflow status change   0
Record write             0
Native AI execution      0
Notification/message     0
Webhook                  0
D1 / Queue / Worker      0
Schedule                 disabled
Production               blocked
```

## Next phase

After this read-only boundary is recorded, prepare the complete disabled Workflow Step mapping and notification payload Preview in Repository only. Do not modify or activate the two live UI Automations and do not send a message.
