# Lark Native AI Disabled Workflow Shells v1

## Status

```text
WORKSTREAM                    = LARK_NATIVE_AI_DISABLED_WORKFLOWS_V1
BRANCH                        = work/lark-native-ai-disabled-workflows-v1
BASE_MAIN_SHA                 = 18bb72741821a4068da0ef0b985b13502a6fd793
MODE                          = REMOTE_LARK_WORKFLOW_CREATE_ONLY
WORKFLOW_CREATE_MAX           = 2
WORKFLOW_UPDATE               = 0
WORKFLOW_STATUS_CHANGE        = 0
RECORD_WRITE                  = 0
NOTIFICATION                  = 0
WEBHOOK                       = 0
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
```

## Live authority

Fresh readiness evidence:

```text
attempt                  outputs/lark-native-ai-workflow-readiness/20260803T182338227Z-18bb72741821-82191
status                   ready_to_create_disabled_workflows
blockerCount             0
settingsMatch            true
notification log         zero_drift
workflow inventory       0
planned disabled creates 2
```

Exact target titles:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

## Objective

สร้าง Workflow identity สองรายการใน Base จริงแบบ disabled โดยใช้ Lark Workflow Create API เท่านั้น และไม่วาง Trigger/Action ที่อาจทำงานก่อนการ Review ขั้นถัดไป

V1 จึงสร้าง **disabled shells** แบบตั้งใจ:

```json
{
  "title": "<exact approved title>",
  "steps": []
}
```

Lark รองรับ Workflow ที่ `steps=[]` และ Workflow ใหม่ถูกสร้างเป็น disabled โดยปริยาย การ Enable ใช้ API คนละเส้นทางและไม่อยู่ใน allowlist ของ Operator นี้

## Why empty shells are authoritative

Phase นี้มีหน้าที่ล็อก Workflow identity และป้องกัน duplicate ก่อน Config payload จริง ไม่ใช่ Activation และไม่ใช่ Notification Preview

การสร้าง Trigger, Native AI prompt actions, Message action, Notification Log action และ sent-state action ต้องผ่าน Phase แยก เพราะต้อง Review field IDs, conditions, payload, dedupe, failure semantics และ Group receiver โดยยังคง disabled ตลอด

การใช้ shell ว่างทำให้:

- ไม่มี Trigger ที่รับ Record ใหม่หรือ Record update;
- ไม่มี Native AI call;
- ไม่มี Lark Message action;
- ไม่มี Record write หรือ Notification Log write;
- ไม่มี Schedule;
- ไม่มี latent action ที่อาจเริ่มทำงานหากมีการเปลี่ยนสถานะผิดพลาดนอก Operator.

## Exact behavior

1. ตรวจ clean current `main` ตรง `origin/main`;
2. ตรวจทุก `MKT_*_ENABLED=false`;
3. อ่าน readiness สดทั้ง Tables, Fields, Views, Settings, Chat และ Workflow inventory;
4. require `blockerCount=0` และ destination/settings match;
5. ตรวจ target title แบบ exact;
6. ถ้าไม่พบ สร้างเฉพาะ shell ที่ขาด สูงสุด 2 รายการ;
7. body มีเพียง `client_token`, `title`, `steps=[]`;
8. ไม่ส่ง `status` และไม่เรียก enable/disable/update API;
9. รอ 10 วินาที;
10. List/Get readback ต้องพบแต่ละ title หนึ่งรายการ, status disabled/draft และ `steps=[]`;
11. rerun ต้องเป็น `already_zero_drift` และ create 0;
12. partial prior create อนุญาตให้สร้างเฉพาะ shell ที่ยังขาดใน explicit rerun ถัดไป.

## Failure semantics

กรณีต่อไปนี้หยุดก่อน create:

- readiness มี blocker;
- destination หรือ Settings ไม่ตรง;
- target title ซ้ำ;
- target Workflow เปิดอยู่;
- target Workflow มี status ไม่รู้จัก;
- target Workflow ที่มีอยู่แล้วมี Step ใด ๆ;
- local execution flag เปิด;
- Repository ไม่ใช่ clean current main.

Create เรียงทีละรายการและไม่ retry อัตโนมัติ หากผลลัพธ์กำกวมให้รัน explicit attempt ใหม่ ซึ่งจะเริ่มจาก inventory และ deterministic client token เดิม

## Remote allowlist

อนุญาตเฉพาะ:

- tenant token;
- List Tables / Fields / Views และ Get View;
- bounded Settings Record read;
- Chat list read;
- Workflow list/get;
- `POST /open-apis/base/v3/bases/{base}/workflows` สูงสุด 2 ครั้ง โดย exact body validator.

ห้าม:

- Workflow update/delete/enable/disable;
- Record create/update/delete;
- Message send;
- Webhook;
- D1, Queue, Worker, Provider, Schedule หรือ Production action.

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

## Expected result

```text
status                       zero_drift
workflowCreateCount          0..2
workflowCount                2
stepCount per workflow       0
workflowUpdateCount          0
workflowStatusChangeCount    0
automationEnabled            false
notificationCount            0
recordWriteCount             0
scheduleEnabled              false
production                   BLOCKED
```

Evidence:

```text
outputs/lark-native-ai-disabled-workflows/<attempt>/summary.json
```

Evidence ไม่เก็บ Workflow ID, Chat ID, Record ID, field ID, token หรือ client token

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

Branch Verification ต้องผ่าน focused Meta, WooCommerce, Chatwoot และ TikTok regressions บน Exact Head

## Next phase

หลัง Live readback เป็น zero drift จึงเปิดงานใหม่สำหรับ **disabled Workflow configuration and payload preview** โดย update เฉพาะสอง Workflow identities นี้และยังห้าม Enable/Send จนได้รับคำสั่งแยกต่างหาก
