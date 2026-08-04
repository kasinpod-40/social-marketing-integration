# Lark Native AI Disabled Configuration & Notification Payload Preview v3

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_V3
MODE                          = REPOSITORY_ONLY
LIVE_CONFIGURATION            = BLOCKED
AUTOMATION_ACTIVE             = 0
NATIVE_AI_CALL                = 0
RECORD_WRITE                  = 0
NOTIFICATION_SEND             = 0
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Live UI evidence

The user confirmed in Lark Base UI that:

1. `insight_summary`, `strengths`, `weaknesses` and `recommendations` are Custom AI fields exported as Text.
2. Base Automation exposes the action `AI-generated text (GPT model)`.
3. An Automation AI result can be selected as the value of `Update record`.
4. The target table can be `🧠 MKT_AI_Report_Runs`.
5. Record matching can use `report_id = trigger report_id`.
6. The AI action output was visibly bound to `insight_summary`.
7. No save, test, activation, AI run or Record write was performed during capability inspection.

This resolves the earlier Custom-AI-field automatic-generation uncertainty by selecting an explicit Automation path instead.

## Workflow 1 corrected design

```text
Trigger on eligible pending 🧠 MKT_AI_Report_Runs row
→ AI-generated text action for insight_summary
→ AI-generated text action for strengths
→ AI-generated text action for weaknesses
→ AI-generated text action for recommendations
→ Update the exact current/matched AI Run
   - map four action outputs into the four target fields
   - generation_status=generated
   - failure_code empty
   - generated_at=automation_now
```

Each AI action returns one text result. Four actions are therefore required. There is no Send Message or Notification Log action in Workflow 1.

The complete approved prompt text for each action has not yet been captured. Live configuration remains blocked until prompt capture is complete.

## Workflow 2

The notification design remains unchanged:

```text
eligible generated executive AI Run
→ exact Snapshot
→ exact enabled Settings destination
→ exact Notification Log dedupe
→ pending log
→ one Lark message
→ sent-state updates
```

The current Base Automation action list does not expose Hash, SHA-256, Crypto, Formula, Set variable or Data processing. `HTTP request` is not an approved workaround. The canonical payload SHA-256 method therefore remains unproven.

## Current blockers

```text
LARK_NATIVE_AI_PROMPT_CAPTURE_INCOMPLETE
LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
```

Advisory only:

```text
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
```

## Complete remaining permission bundle

```text
base:workflow:read
base:workflow:create
base:workflow:update
base:workflow:write
```

`base:workflow:delete` is not part of the current plan.

## Safety boundary

```text
Remote Lark read/write       0 / 0
Workflow create/update       0 / 0
Workflow status change       0
Native AI call               0
Record write                 0
Notification send            0
Webhook / D1 / Queue         0
Worker / Provider            0
Schedule                     disabled
Production                   BLOCKED
```

## Offline command

```bash
node scripts/lark-native-ai-disabled-configuration-preview.mjs
```

Expected:

```text
contractVersion   lark_native_ai_disabled_configuration_preview_v3
status            repository_preview_automation_ai_binding_verified_live_configuration_blocked
blockerCount      2
advisoryCount     1
remoteActionCount 0
production        BLOCKED
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-disabled-configuration-preview.test.js
node --test tests/scripts/lark-native-ai-disabled-configuration-preview.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
