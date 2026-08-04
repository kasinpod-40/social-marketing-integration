# Lark Native AI Prompt Capture v4

## Objective

Capture the four user-approved Thai prompts for the inactive Lark Base Automation and close `LARK_NATIVE_AI_PROMPT_CAPTURE_INCOMPLETE` without changing the live Base.

## Prompt authority

The complete prompt text is stored in:

```text
packages/config/src/lark-native-ai-automation-prompt-contract.js
```

Prompt version:

```text
lark_native_ai_automation_prompts_v1
```

Target fields:

```text
insight_summary
strengths
weaknesses
recommendations
```

Each prompt is bound to one `AI-generated text (GPT model)` action and one exact Update Record target field.

## Reference slots

The copied Lark rich-reference tokens are represented by stable semantic placeholders for manual UI binding:

```text
scope_type
channel_key
window_days
data_status
readiness_status
readiness_message
severity
metric_summary_json
executive_channel_statuses
```

No raw Lark Field ID, Record ID, Chat ID, token, secret or Webhook is stored.

## Preview v4

Expected local preview:

```text
contractVersion  lark_native_ai_disabled_configuration_preview_v4
status           repository_preview_prompts_captured_live_configuration_blocked
blockerCount     1
blocker           LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
remoteActionCount 0
production       BLOCKED
```

## Safety

```text
Remote Lark read/write       0 / 0
Workflow create/update       0 / 0
Workflow status change       0
Native AI call               0
Record write                 0
Notification send            0
Schedule                     disabled
Production                   BLOCKED
```

The two live Automations remain inactive. This task does not authorize Save, Test Results, activation, message sending or Notification Log writes.

## Remaining blocker

The current Base Automation action list has no native Hash/SHA-256 action. Do not use HTTP Request or AnyCross as an unreviewed workaround. The notification checksum architecture must be resolved separately while preserving fail-closed dedupe and redacted evidence.
