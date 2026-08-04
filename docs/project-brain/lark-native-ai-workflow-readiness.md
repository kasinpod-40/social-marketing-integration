# Project Brain — Lark Native AI Workflow Readiness

## Current verified phase

```text
🧠 MKT_AI_Report_Runs       present / required fields ready
🔔 MKT_Notification_Log     zero_drift / 15 fields / 6 views
Social MKT Executive Reports exact destination bound
⚙️ MKT_Report_Settings      66 integration rows / one destination
Automation total            2
Active / Inactive           0 / 2
Schedule                    disabled
Production                  blocked
```

## Live UI Automation authority

The two exact inactive Automations remain:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

The Workflow List API still returns zero and does not expose these UI Automation identities. Manual UI is the current edit path.

## AI generation evidence

Four target fields exist as Custom AI fields and export as Text:

```text
insight_summary
strengths
weaknesses
recommendations
```

The user then verified a more controllable Automation path:

```text
AI-generated text (GPT model)
→ result token available to Update record
→ target table 🧠 MKT_AI_Report_Runs
→ exact record filter can use report_id = trigger report_id
→ result visibly bound to insight_summary
```

No test, save, AI execution, Record write or activation occurred during inspection.

The selected final Workflow 1 design uses four explicit AI-generated-text actions, one result per target field, followed by one exact Record update. Custom AI field automatic-generation policy is no longer required by this path.

## Current blockers

```text
LARK_NATIVE_AI_PROMPT_CAPTURE_INCOMPLETE
LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
```

The first blocker means the complete approved prompt text for all four AI actions has not been captured. The second means Base Automation does not currently expose a proven Hash/SHA-256/Crypto/Formula/Variable action. HTTP request is not an approved workaround.

Advisory only:

```text
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
```

## Final architecture

```text
Central Report Metrics
→ 🧠 MKT_AI_Report_Runs pending row
→ four explicit Lark Automation AI text actions
→ four outputs written to the exact AI Run
→ generation_status=generated
→ executive eligibility gate
→ exact Snapshot
→ exact enabled Settings destination
→ Notification Log dedupe
→ one Lark group message
→ sent-state updates
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

- every `MKT_*_ENABLED` flag remains false;
- Workflow create/update/status change is zero;
- Native AI execution is zero;
- Record writes and messages are zero;
- no Webhook, D1, Queue, Worker, Provider, Schedule or Production action occurs;
- raw destination IDs and credentials remain excluded from evidence.

## Next phase

1. Capture the complete exact prompt text for all four AI target outputs without saving or testing.
2. Choose a supported checksum architecture; do not use HTTP request as an implicit escape hatch.
3. Review the complete disabled Step mapping before any Live edit.
4. Keep both Automations inactive.

Full contracts:

```text
docs/tasks/lark-native-ai-workflow-readiness-v1.md
docs/tasks/lark-native-ai-target-group-name-v1.md
docs/tasks/lark-native-ai-destination-binding-v1.md
docs/tasks/lark-native-ai-disabled-workflows-v1.md
docs/tasks/lark-native-ai-disabled-configuration-preview-v1.md
```
