# Current Task — Lark Notification Runtime Activation v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_AND_EXACT_HEAD_CI
CURRENT_PROGRAM                     = LARK_NOTIFICATION_RUNTIME_ACTIVATION_V1
BRANCH                              = feat/lark-notification-runtime-activation-v1
BASE_MAIN_SHA                       = dd9c1f33be877e77b6e76c8b537ab916dc6a0b50
CONTROLLED_UAT                      = CLOSED_PASS
RETAINED_MESSAGE_COUNT              = 1
ADDITIONAL_MESSAGE_SEND_COUNT       = 0
RUNTIME_ACTIVATION_APPROVED         = true
QUEUE_ADMISSION_APPROVED            = false
AUTOMATION_ACTIVATION_APPROVED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
WEBHOOK_ACTIVATION_APPROVED         = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/lark-notification-runtime-activation-v1.md
```

## Objective

เปิด Worker-side Lark Executive Notification Runtime ใน Integration Workspace หลัง Controlled UAT
ผ่านแล้ว โดยเปิดเฉพาะ D1 delivery consumer, Lark message send/mirror gates และ exact source Report
Settings สำหรับ Executive `1D/3D/7D/30D`.

Activation นี้ต้องไม่ส่ง Queue job, ไม่ส่งข้อความใหม่, ไม่เพิ่ม Notification delivery row, ไม่เปิด
Lark Automation, Cron/Schedule admission, Webhook หรือ Production.

## In scope

- แยก Runtime mode ออกจาก Controlled UAT mode;
- รับเฉพาะ `lark_notification_runtime` trigger สำหรับ non-UAT AI identity;
- ปฏิเสธ `notification-uat:*` เมื่อ Worker อยู่ใน Runtime mode;
- deploy Notification-only Worker flags ที่ 100% traffic;
- เปิด `ai_enabled` และ `notification_enabled` เฉพาะ Report Settings ที่อยู่ใน exact Executive
  source chain ของ `1D/3D/7D/30D`;
- ตรวจ retained D1 `sent/mirrored` และ Lark Notification Log ก่อน/หลัง Activation;
- พิสูจน์ Queue admission = 0 และ additional message send = 0;
- มี exact rollback ที่ deploy Safe Worker และคืน exact Report Settings false.

## Out of scope

- Notification discovery/dispatcher/producer;
- Queue admission;
- Lark Automation;
- Cron/Schedule notification producer;
- Webhook/HTTP admission;
- AI provider, AI Worker หรือ custom model runtime;
- Production profile/assets;
- Connector, Report, Queue, D1 หรือ Lark engine ใหม่;
- การรัน Controlled UAT หรือ Mirror Recovery เดิมซ้ำ.

## Preserved parallel authority

Meta retained recovery authority remains unchanged and is not transferred to this workstream. The only
permitted Meta current-recovery entrypoint remains:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

This Notification Runtime task does not invoke, replace or authorize that Meta Terminal, Provider replay,
D1 Queue resend, Lark mutation or Production action.

## Contract

1. Runtime ใช้ `MKT_ENV=development`, `MKT_CUSTOMER_PROFILE=integration_workspace`,
   `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`.
2. Worker mode ต้องเป็น `runtime`; `controlled_uat` และ `runtime` identities ห้ามข้ามกัน.
3. ทุก execution flag อื่นต้องถูก materialize เป็น false.
4. Wrangler triggers ต้องคงเดิม byte-equivalent ใน active/safe generated config.
5. Source `scheduled-jobs.js` ต้องยังไม่มี `LARK_NOTIFICATION_SEND`.
6. D1 ต้องมี applied notification schema, active lock = 0 และทุก delivery เป็น `sent/mirrored`.
7. Controlled UAT retained row ต้องมี exactly one D1 row, one Lark Log row และ AI Run marked sent.
8. Activation mutation อนุญาตเฉพาะ one Worker deploy และ exact Report Settings updates.
9. Observation หลัง Activation ต้องเห็น delivery/log/message count ไม่เปลี่ยน.
10. Failure หลัง mutation ใดต้อง restore Settings false และ Safe Worker.
11. Production คง `BLOCKED`.

## Required verification

```bash
npm ci
npm run check
node --test \
  tests/application/job-catalog.test.js \
  tests/application/lark-notification-active-job-router.test.js \
  tests/application/lark-notification-runtime-activation.test.js \
  tests/application/lark-notification-runtime-activation-exact-terminal.test.js \
  tests/config/lark-notification-runtime-config.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Repository implementation is in progress. No Remote Worker deployment, Lark Record write, Queue send,
notification send, Automation, Schedule, Webhook or Production action has been performed from this branch.
