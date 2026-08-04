# Lark Native AI Disabled Configuration & Notification Payload Preview v2

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_V2
MODE                          = REPOSITORY_ONLY
CUSTOM_AI_FIELD_BINDING       = VERIFIED
LIVE_CONFIGURATION            = BLOCKED
AUTOMATION_ACTIVE             = 0
NATIVE_AI_CALL                = 0
RECORD_WRITE                  = 0
NOTIFICATION_SEND             = 0
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Live authority entering this phase

Read-only reconciliation passed on:

```text
main                          da502ebb0f2348edd2b120891a509d0da89393f4
status                        manual_ui_automations_locked_api_workflow_inventory_empty
mode                          read_only_reconciliation
UI Automations                2
Active                        0
Inactive                      2
Workflow List API inventory   0
Workflow create/update        0 / 0
Notification                  0
Schedule                      disabled
Production                    blocked
```

The two user-confirmed inactive placeholders remain:

```text
AI Materialization → MKT_AI_Report_Runs
🧾 MKT_Report_Snapshots / report_id → Delay 1 minute

Eligible AI Run → Lark Group Notification
🧠 MKT_AI_Report_Runs / ai_run_key → Delay 1 minute
```

The placeholders remain unchanged throughout this Repository phase.

## Verified Custom AI field authority

Four user-confirmed Lark Base screenshots on 2026-08-04 prove that the target outputs are already separate `Custom AI field` columns in:

```text
🧠 MKT_AI_Report_Runs
```

Exact outputs:

```text
insight_summary
strengths
weaknesses
recommendations
```

Each field:

- is configured as `Custom AI field`;
- exports as `Text`;
- writes its own field directly (`field_self` binding);
- has a Thai prompt for the current record;
- visibly references `scope_type`, `channel_key`, `window_days`, `data_status`, `readiness_status` and `readiness_message`.

The screenshots did not expose the entire prompt tail or an explicit automatic-generation policy. Therefore the exact field-self output mapping is verified, but auto-generation for future new/updated rows remains unproven.

## Corrected architecture decision

The final Automation must not add a second Native AI generation action. AI generation belongs to the four Custom AI fields themselves.

Corrected architecture:

```text
Central Report Metrics
→ 🧠 MKT_AI_Report_Runs source fields
→ four Lark Custom AI fields
→ Automation verifies all four outputs are populated
→ Automation marks generation_status=generated
→ executive-only notification eligibility
→ exact Snapshot
→ exact enabled Report Settings destination
→ Notification Log dedupe
→ one Lark group message
→ sent-state updates
```

## Workflow 1 — AI Materialization → MKT_AI_Report_Runs

### Final Trigger

```text
When a new or updated record matches all conditions
Table: 🧠 MKT_AI_Report_Runs
```

Conditions:

```text
generation_status = pending
readiness_status IN report_available, report_partial
preview_mode = false
insight_summary is not empty
strengths is not empty
weaknesses is not empty
recommendations is not empty
```

### Final action

Update the current AI Run only:

```text
generation_status = generated
failure_code       = empty
generated_at       = automation_now
```

This Workflow must not contain:

```text
Native AI generation action
Message action
Notification Log action
HTTP/Webhook action
Schedule or activation action
```

## Workflow 2 — Eligible AI Run → Lark Group Notification

### Final Trigger

```text
When a new or updated record matches all conditions
Table: 🧠 MKT_AI_Report_Runs
```

Conditions:

```text
report_id is not empty
scope_type = executive
generation_status = generated
notification_eligible = true
preview_mode = false
sent_to_group = false
dedupe_key is not empty
```

### Exact lookup chain

```text
AI Run.report_id
→ exactly one 🧾 MKT_Report_Snapshots row
→ report_setting_key + customer_profile + period_start + period_end
→ exactly one ⚙️ MKT_Report_Settings row
→ enabled=true + notification_enabled=true + group_id not empty
```

Notification dedupe chain:

```text
notification_attempt_key = ai_run_key + "::" + dedupe_key
→ 🔔 MKT_Notification_Log must contain zero matching rows before send
```

### Final actions

1. Find exact Snapshot.
2. Find exact enabled Settings destination.
3. Find exact Notification Log attempt; an existing attempt dedupes without send.
4. Add pending Notification Log row.
5. Send one Lark message to `Social MKT Executive Reports`.
6. Update Notification Log to `sent` with `sent_at`.
7. Update AI Run `sent_to_group=true` and `sent_at`.

Missing or multiple Snapshot/Settings/Log identities fail closed. Automatic retry remains disabled until exact failure and dedupe semantics are proven.

## Notification payload preview

Template:

```text
📊 Social MKT Executive Report — {window_days}D
ช่วง: {period_start} ถึง {period_end}
ระดับ: {severity}
สถานะข้อมูล: {readiness_status}

สรุป
{insight_summary}

จุดแข็ง
{strengths}

จุดที่ต้องระวัง
{weaknesses}

ข้อเสนอแนะ
{recommendations}

สร้างจาก Central Report Metrics ที่ผ่านการตรวจสอบ
```

The preview computes a SHA-256 checksum over the canonical redacted payload and produces the exact 15-field Notification Log record shape. It stores only the approved destination hash:

```text
7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9
```

Raw Chat ID, Webhook URL, token and App Secret remain forbidden in payload/evidence.

## Current live-configuration blockers

The previous output-binding blocker is resolved. Two exact blockers remain:

```text
LARK_CUSTOM_AI_AUTOGENERATION_POLICY_UNPROVEN
LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
```

Meaning:

1. The four field-self Custom AI output bindings are verified, but the exact automatic generation policy for future new/updated rows has not been captured.
2. The exact Lark Automation capability for computing the canonical redacted payload SHA-256 has not been proven.

The current empty Workflow List API inventory remains an advisory rather than a field-binding blocker:

```text
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
```

Future edits must use the confirmed manual UI path unless exact API identity is proven.

## Complete remaining permission bundle

The full later API bundle remains disclosed together:

```text
base:workflow:read
base:workflow:create
base:workflow:update
base:workflow:write
```

`base:workflow:delete` is not required by the current plan. This Repository Preview requests no new permission.

## Offline command

```bash
node scripts/lark-native-ai-disabled-configuration-preview.mjs
```

Expected:

```text
status                  repository_preview_field_binding_verified_live_configuration_blocked
mode                    repository_only
Custom AI fields        4
field binding           field_self / verified
blocker count           2
advisory count          1
remote action count     0
notification send       0
schedule                disabled
production              BLOCKED
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

Branch Verification must also pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head.
