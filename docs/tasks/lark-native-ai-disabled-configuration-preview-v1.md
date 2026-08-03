# Lark Native AI Disabled Configuration & Notification Payload Preview v1

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_V1
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

The two user-confirmed inactive placeholders are:

```text
AI Materialization → MKT_AI_Report_Runs
🧾 MKT_Report_Snapshots / report_id → Delay 1 minute

Eligible AI Run → Lark Group Notification
🧠 MKT_AI_Report_Runs / ai_run_key → Delay 1 minute
```

The placeholders remain unchanged throughout this Repository phase.

## Architecture decision

The final AI Automation must not recreate Central Report calculations or synthesize Stable keys from Raw data. The existing Shared Report and Controlled Preview path already materializes `🧠 MKT_AI_Report_Runs` rows with exact Report identity, source checksum, readiness and dedupe fields.

The final AI generation Trigger therefore moves to:

```text
🧠 MKT_AI_Report_Runs
```

This preserves the locked architecture:

```text
Source / Connector
→ Normalized + Daily
→ Central Report Metrics
→ MKT_AI_Report_Runs
→ Lark Native AI
→ Lark Automation
→ Lark Group Notification
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
metric_summary_json is not empty
preview_mode = false
insight_summary is empty
strengths is empty
weaknesses is empty
recommendations is empty
```

### Final actions

1. Lark Native AI reads only validated Shared Report fields:
   - `metric_summary_json`
   - `readiness_status`
   - `readiness_message`
   - `coverage_rate`
   - `channel_status_vector_json`
   - `window_days`
2. It produces:
   - `insight_summary`
   - `strengths`
   - `weaknesses`
   - `recommendations`
3. The current AI Run is updated:
   - `generation_status=generated`
   - `failure_code=null`
   - `generated_at=automation_now`

This Workflow has no Message or Notification Log action.

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

Missing or multiple Snapshot/Settings/Log identities fail closed. Automatic retry is disabled until the exact failure and dedupe semantics are proven.

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

Raw Chat ID, Webhook URL, token and App Secret are forbidden in payload/evidence.

## Current live-configuration blockers

Repository Preview is complete, but Live configuration remains blocked by three exact unknowns:

```text
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
LARK_NATIVE_AI_OUTPUT_BINDING_UNPROVEN
LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN
```

Meaning:

1. The current Workflow List API does not expose the two Base UI Automations, so an API update identity is unavailable.
2. The exact Lark UI binding from Native AI output into four destination fields has not been captured and verified.
3. The exact Lark Automation capability for computing the canonical redacted payload SHA-256 has not been proven.

No Live UI edit or API mutation is authorized until these are resolved together.

## Complete remaining permission bundle

The full later API bundle is disclosed at once:

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
status                  repository_preview_ready_live_configuration_blocked
mode                    repository_only
workflow count          2
payload checksum        SHA-256
blocker count           3
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
