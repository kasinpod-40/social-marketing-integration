# Lark Native AI Destination Binding v1

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_DESTINATION_BINDING_V1
BASE_MAIN_SHA                 = eb6aab4735b3d5de7688ca28e58ede03d2f426a3
TARGET_GROUP                  = Social MKT Executive Reports
TARGET_SETTINGS_TABLE         = ⚙️ MKT_Report_Settings
EXPECTED_INTEGRATION_ROWS     = 66 from latest live readiness evidence
MUTATION                      = group_id only
AI_ENABLED                    = false
NOTIFICATION_ENABLED          = false
WORKFLOW_CREATE               = 0
WORKFLOW_STATUS_CHANGE        = 0
NOTIFICATION                  = 0
WEBHOOK                       = 0
SCHEDULE                      = disabled
PRODUCTION                    = blocked
```

## Verified blocker

Remote read-only readiness resolved the exact visible Lark group once and retained only its SHA-256 identity:

```text
exactNameMatchCount      1
resolved                 true
integrationRowCount      66
distinctDestinationCount 0
blocker                   SETTINGS_GROUP_ID_MISSING
```

AI schema and `🔔 MKT_Notification_Log` remain zero drift. Both approved Workflows are absent and remain uncreated in this phase.

## Objective

Resolve the raw Chat ID in memory from the exact group name and bind it to the existing `group_id` field of every `integration_workspace` Settings row whose destination is empty.

The raw Chat ID is stored only where required as the Lark Base destination authority. It is never printed or persisted in local evidence. Output contains only SHA-256 and counts.

## Fail-closed contract

Before write, the operator requires:

- clean current `main` exactly equal to freshly fetched `origin/main`;
- Node.js 22 or newer;
- Integration Workspace runtime and every `MKT_*_ENABLED` flag false;
- exact unique `⚙️ MKT_Report_Settings` table and required Fields;
- one or more exact `customer_profile=integration_workspace` rows;
- exact one visible group named `Social MKT Executive Reports`;
- every Integration row has `ai_enabled=false` and `notification_enabled=false`;
- every non-empty retained `group_id`, if any, already equals the resolved Chat ID;
- no more than 100 empty destination rows, preserving one bounded Lark batch.

A different retained destination, multiple destination values, missing/duplicate group, activation flag, schema drift or oversized write set blocks before mutation.

## Mutation boundary

Allowed Remote requests:

```text
tenant token
List Tables
List Settings Fields
List Settings Records
List chats visible to the App
one batch_update to Settings Records
fresh Settings Record readback
```

The batch body is inspected before fetch. Every row must contain exactly:

```json
{
  "record_id": "[redacted]",
  "fields": {
    "group_id": "[exact resolved Chat ID]"
  }
}
```

No other Field, Record create/delete, schema/view mutation, Workflow API, message API, Webhook, D1, Queue, Worker or Provider path is allowed.

## Verification

After the one write, the operator waits 10 seconds and requires:

- same Integration row count;
- zero empty destination rows;
- exactly one destination value;
- SHA-256 of Settings `group_id` equals SHA-256 of the exact visible Chat ID;
- activation flags remain false.

A rerun must return `already_zero_drift` with zero Record writes.

## Exact Terminal after merge

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git pull --ff-only origin main && \
MKT_CONNECTOR_TIKTOK_ENABLED=false \
MKT_YOUTUBE_ANALYTICS_ENABLED=false \
CONFIRM_LARK_NATIVE_AI_DESTINATION_BINDING=BIND_LARK_NATIVE_AI_DESTINATION_V1 \
node scripts/lark-native-ai-destination-binding-terminal.mjs --execute
```

## Evidence

Private local evidence:

```text
outputs/lark-native-ai-destination-binding/<attempt>/summary.json
```

No raw Chat ID, Record ID, App token, access token or Webhook URL is persisted.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/lark-native-ai-destination-binding.test.js
node --test tests/scripts/lark-native-ai-destination-binding-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

After successful binding, rerun the existing Workflow Readiness. Only then may a separate workstream create the two reviewed Workflows disabled. Enabling or sending remains separately authorized.
