# Lark Notification Log Schema v1

## Status

```text
WORKSTREAM                    = LARK_NOTIFICATION_LOG_SCHEMA_V1
BRANCH                        = implementation/lark-notification-log-schema-v1
BASE_MAIN_SHA                 = 51d8b6612b016ac26f2c5f496547547fdda0d7e2
AI_PREVIEW                    = PASSED_MANUAL_8_COMPLETED_32_SKIPPED
TABLE_CREATE                  = NOT_RUN
RECORD_READ_WRITE             = 0
AUTOMATION                    = DISABLED
NOTIFICATION_SEND             = 0
WEBHOOK_ACTION                = 0
SCHEDULE                      = DISABLED
REMOTE_D1_QUEUE_WORKER        = 0
PROVIDER_ACTION               = 0
PRODUCTION                    = BLOCKED
```

## Objective

สร้าง Notification attempt log เพียงหนึ่งตารางหลัง AI Preview ผ่าน โดยใช้ Lark OpenAPI client และ View-filter authority เดิมของ Repository ไม่สร้าง Lark engine, Notification engine, Settings table หรือ Destination table ใหม่

Physical table:

```text
🔔 MKT_Notification_Log
```

Logical contract name:

```text
MKT_Notification_Log
```

Lark client ปัจจุบันสร้าง Table ด้วย `name`, `default_view_name` และ `fields` โดยไม่มี request property สำหรับ Table icon แยกต่างหาก ดังนั้น v1 ใช้ Emoji prefix `🔔` เป็น icon ที่ deterministic และตรวจซ้ำได้

หากพบตารางเดิมชื่อ `MKT_Notification_Log` แบบไม่มี Emoji ระบบจะหยุดก่อนเขียน ห้าม Rename อัตโนมัติ เพราะอาจเป็นตารางที่มีข้อมูลหรือเป็นของ Workstream อื่น

## Exact fields

| # | Field | Type | Contract |
|---:|---|---|---|
| 1 | `notification_attempt_key` | Text / Primary | Stable unique attempt identity |
| 2 | `ai_run_key` | Text | Stable AI source identity |
| 3 | `dedupe_key` | Text | Prevent same notification twice |
| 4 | `destination_key_hash` | Text | Destination hash only |
| 5 | `window_days` | SingleSelect | `1`, `3`, `7`, `30` |
| 6 | `period_start` | DateTime | `yyyy-MM-dd HH:mm`, no auto-fill |
| 7 | `period_end` | DateTime | `yyyy-MM-dd HH:mm`, no auto-fill |
| 8 | `severity` | SingleSelect | `info`, `warning`, `critical` |
| 9 | `payload_checksum` | Text | Redacted payload SHA-256 |
| 10 | `attempt_status` | SingleSelect | `pending`, `sending`, `previewed`, `sent`, `deduped`, `blocked`, `failed` |
| 11 | `attempted_at` | DateTime | Attempt start time, no auto-fill |
| 12 | `sent_at` | DateTime | Successful send time, no auto-fill |
| 13 | `failure_code` | Text | Sanitized stable error code |
| 14 | `redacted_failure_message` | Text | No secret, raw destination or PII |
| 15 | `preview_mode` | Checkbox | True means no real send |

Every Field receives a Thai description during create. The first Field is emitted first and must read back as the Primary Field.

Forbidden values:

- Webhook URL;
- raw Group ID;
- tenant/app token;
- authorization header;
- message payload containing customer PII;
- unredacted provider/Lark error body.

## Exact Views

```text
🌐 All Notification Attempts  all rows
🧪 Preview Attempts           preview_mode = true
⏳ Pending / Sending          attempt_status = pending OR sending
✅ Sent                        attempt_status = sent
❌ Failed                      attempt_status = failed
🛑 Blocked / Deduped          attempt_status = blocked OR deduped
```

Select filters resolve logical option names to exact live option IDs. Checkbox filters preserve Boolean `[true]`. Every filtered View is hydrated with Get View before comparison. Existing non-empty conflicting filters stop before mutation.

## Additive and fail-closed behavior

Allowed Remote requests:

```text
POST  tenant token
GET   List Tables
POST  Create Table exactly once
GET   List Fields
POST  Create only missing approved Fields
GET   List/Get Views
POST  Create only missing approved Views
PATCH Configure only empty approved View filters
```

Forbidden:

```text
Table rename/delete
Field update/delete/type change
Select option removal
View delete
Record read/write/delete
Automation create/update/enable
Webhook or group message send
D1 / Queue / Worker / Provider
Schedule / Production
```

The installer is idempotent:

- exact completed schema returns `already_zero_drift`;
- a partial attempt may add only missing approved Fields/Views/filters;
- duplicate names, unknown extra schema, type conflict, option conflict or non-empty filter conflict fail closed;
- no automatic delete, rename, overwrite or retry after an ambiguous non-rate-limit create response.

## Exact Terminal

Plan-only:

```bash
node scripts/lark-notification-log-schema-terminal.mjs
```

Reviewed live schema command after merge:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration && git fetch --quiet origin main && git switch main && git pull --ff-only origin main && CONFIRM_LARK_NOTIFICATION_LOG_SCHEMA=APPLY_LARK_NOTIFICATION_LOG_SCHEMA_V1 node scripts/lark-notification-log-schema-terminal.mjs --execute
```

Execution requires:

- Node.js 22+;
- clean local `main` exactly equal to freshly fetched `origin/main`;
- Integration Workspace config;
- all local `MKT_*_ENABLED` flags false;
- Lark credentials/Base token available only from Environment or private `.dev.vars`;
- exclusive local lock;
- one immutable private evidence directory.

## Verification

Required Repository gates:

```bash
npm ci
npm run check
node --test tests/scripts/lark-notification-log-schema.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Live success requires:

```text
exact physical Table      1
exact Fields             15
exact Views               6
exact filtered Views      5
Record read/write          0/0
Automation                 0
Notification/Webhook       0/0
Schedule                   false
Production                 BLOCKED
```

## Activation boundary

This task does not create or enable Automation and does not configure a destination. After schema readback reaches zero drift, the next separately reviewed phase is Notification Preview. `ai_enabled`, `notification_enabled`, `notification_eligible`, `sent_to_group` and Schedule remain disabled/false until that phase passes and receives explicit activation approval.
