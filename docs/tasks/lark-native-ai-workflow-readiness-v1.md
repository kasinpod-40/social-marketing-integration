# Lark Native AI Disabled Workflow Readiness v1

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_WORKFLOW_READINESS_V1
BRANCH                        = work/lark-native-ai-workflow-readiness-v1
BASE_MAIN_SHA                 = e37a98b24bc12b2b8427e68bdbffc617639bca3b
MODE                          = REMOTE_READ_ONLY
WORKFLOW_CREATE               = 0
WORKFLOW_UPDATE               = 0
WORKFLOW_STATUS_CHANGE        = 0
RECORD_WRITE                  = 0
NOTIFICATION                  = 0
WEBHOOK                       = 0
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
```

## Objective

ตรวจ Live Lark prerequisites ที่จำเป็นก่อนสร้าง Workflow สองรายการแบบ disabled โดยไม่สร้างหรือเปิด Workflow ใด ๆ ในงานนี้:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

งานนี้เป็น Phase 6 readiness หลัง AI Preview และ Notification Log schema ผ่านแล้ว ไม่ใช่ activation และไม่ใช่ message test

## Read-only authority

อนุญาตเฉพาะ:

- tenant access token;
- List Tables / Fields / Views และ Get View;
- อ่าน Settings Records แบบ bounded;
- List/Get Base workflows;
- List Lark chats ที่ App มองเห็น;
- เขียน sanitized evidence ลง local filesystem เท่านั้น.

ห้าม:

- Create/Update/Delete Workflow;
- เปลี่ยน Workflow status;
- Create/Update/Delete Record;
- ส่ง Lark message หรือ Webhook;
- เปิด `ai_enabled`, `notification_enabled`, `preview_mode=false` หรือ `notification_eligible=true`;
- D1, Queue, Worker, Provider, Schedule หรือ Production action.

## Exact destination contract

ผู้ใช้ยืนยันชื่อกลุ่มจริงที่ต้องใช้:

```text
Social MKT Executive Reports
```

Readiness ต้อง resolve exact group name ได้หนึ่งรายการจาก Lark Chat inventory และเทียบ SHA-256 ของ Chat ID กับ `group_id` ที่ไม่ว่างและไม่กำกวมใน `⚙️ MKT_Report_Settings` สำหรับ `integration_workspace`

Evidence เก็บเฉพาะ SHA-256 เท่านั้น ห้ามเก็บ raw Chat ID, Webhook URL หรือ Token

กรณีต่อไปนี้ block:

- App มองไม่เห็นกลุ่มหรือพบชื่อซ้ำ;
- `group_id` ยังว่างหรือมีหลายค่า;
- Chat ID hash ไม่ตรงกับ Settings;
- activation flags ใด ๆ ถูกเปิดก่อน Workflow review;
- target Workflow ซ้ำหรือมีรายการใดเปิดอยู่แล้ว.

## Schema prerequisites

ต้องพบแบบ unique:

```text
🧠 MKT_AI_Report_Runs
⚙️ MKT_Report_Settings
🔔 MKT_Notification_Log
```

AI table ต้องมี Fields ที่ workflow ใช้ครบ รวม AI outputs, readiness/safety, dedupe และ sent state

Notification Log ต้องยังเป็น exact zero drift:

```text
Fields 15
Views   6
Filters 5
```

## Workflow inventory behavior

- target Workflow ไม่พบ = `create_disabled` ซึ่งเป็นผลที่คาดไว้ก่อน Phase create;
- พบหนึ่งรายการและ disabled = reuse candidate;
- พบซ้ำ, status ไม่รู้จัก หรือ enabled = block;
- งานนี้ไม่แก้ conflict และไม่สร้าง Workflow เพิ่มเพื่อหลบของเดิม.

## Exact Terminal after merge

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git pull --ff-only origin main && \
MKT_CONNECTOR_TIKTOK_ENABLED=false \
MKT_YOUTUBE_ANALYTICS_ENABLED=false \
CONFIRM_LARK_NATIVE_AI_WORKFLOW_READINESS=RUN_LARK_NATIVE_AI_WORKFLOW_READINESS_V1 \
node scripts/lark-native-ai-workflow-readiness-terminal.mjs --execute
```

ตัวแปรสองรายการถูก override เฉพาะ process นี้ ไม่แก้ `.dev.vars`

## Expected outcome

ผลอาจเป็น `blocked` ได้โดยยังถือว่า audit สำเร็จ เพราะเป้าหมายคือระบุ exact prerequisites ที่ขาดโดยไม่ mutation

หลักฐานอยู่ใต้:

```text
outputs/lark-native-ai-workflow-readiness/<attempt>/summary.json
```

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/lark-native-ai-workflow-readiness.test.js
node --test tests/scripts/lark-native-ai-workflow-readiness-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification ต้องผ่าน focused Meta, WooCommerce, Chatwoot และ TikTok regressions บน Exact Head

## Next decision

เมื่อ read-only result ผ่านหรือระบุ blocker ชัดเจนแล้ว จึงเปิดงานถัดไปเพียงจุดเดียว:

- แก้ destination authority อย่างปลอดภัย หาก group/settings ไม่ตรง; หรือ
- สร้าง exact reviewed Workflow definitions แบบ disabled หาก prerequisites ครบ.

การ Enable และการส่งข้อความจริงต้องได้รับคำสั่งแยกต่างหาก
