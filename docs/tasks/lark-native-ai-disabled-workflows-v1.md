# Lark Native AI Inactive Workflow Placeholders v1

## Current live state

The two exact Automations were created manually in the Lark Base UI because the app did not yet have `base:workflow:create` and the UI would not save an empty Workflow.

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

Exact trigger tables:

```text
AI Materialization → MKT_AI_Report_Runs
trigger table: 🧾 MKT_Report_Snapshots

Eligible AI Run → Lark Group Notification
trigger table: 🧠 MKT_AI_Report_Runs
```

There is no Native AI action, Record write, message action, Webhook, Schedule or status activation.

## Corrected authority

The empty `steps=[]` API shell from the original Phase 6 plan is no longer the live authority. The user-approved UI placeholder is now the exact accepted shape:

1. one `AddRecordTrigger` bound to the exact table;
2. one `Delay` action with duration `1` minute;
3. the Trigger points directly to the Delay;
4. no branch, loop or additional action;
5. Workflow status is disabled/inactive/off/draft.

UI-generated Step IDs are not stable and are not compared literally. The semantic shape, exact table, one-minute delay and inactive status are authoritative.

The optional watched field may be present as `report_id` or `ai_run_key`; Lark UI may omit it from returned Workflow JSON. A conflicting non-empty watched field blocks.

## Reconciliation behavior

The existing guarded operator now treats the exact UI placeholders as zero drift. On the current live state it performs only Workflow list/get and the existing readiness reads; `workflowCreateCount` remains zero, so `base:workflow:create` is not required for this readback.

Any of the following blocks:

- title missing or duplicated;
- Workflow enabled;
- wrong trigger table;
- delay not exactly one minute;
- more or fewer than two Steps;
- Trigger not connected to Delay;
- Message, AI, Record, HTTP, branch, loop or other action present.

No Workflow update, status change, Record write or message route exists in this phase.

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

Expected current-live result:

```text
status                       zero_drift
workflowCreateCount          0
workflowCount                2
observedStepCount            2 per Workflow
placeholderExact             true
workflowUpdateCount          0
workflowStatusChangeCount    0
automationEnabled            false
notificationCount            0
scheduleEnabled              false
production                   BLOCKED
```

## Permissions required for all remaining API phases

The remaining API path must be approved as one bundle before any future Remote Workflow mutation:

```text
base:workflow:read     inspect/list/get
base:workflow:create   only if a missing Workflow must be created
base:workflow:update   install or change disabled Steps
base:workflow:write    enable/disable status in a separately authorized activation phase
base:workflow:delete   not required by the current plan
```

Current reconciliation uses only `base:workflow:read`. No future phase may request permissions piecemeal without listing the complete remaining bundle first.

## Safety boundary

```text
Workflow create          0 on current live state
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

## Required verification

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

## Next phase

After read-only zero drift, prepare the complete disabled Workflow configuration and notification payload Preview in Repository only. Do not update the live Workflows, activate them or send a message until the full Step mapping and the complete required permission bundle have been reviewed together.
