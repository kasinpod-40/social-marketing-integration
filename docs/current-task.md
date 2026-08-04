# Current Task — Lark Notification Runtime Activation v1

## Status

```text
TASK_STATUS                         = RUNTIME_ACTIVE_CLOSED_PASS
CURRENT_PROGRAM                     = LARK_NOTIFICATION_RUNTIME_ACTIVATION_V1
BRANCH                              = main
ACTIVATION_MAIN_SHA                 = 5833c558d70efcfca08d476a30449b72d8555213
ACTIVE_WORKER_VERSION               = 958e183e-fb0d-4795-a547-d805111ca6fc
CONTROLLED_UAT                      = CLOSED_PASS
RUNTIME_ACTIVATION                  = CLOSED_PASS
RUNTIME_ENABLED                     = true
SEND_ENABLED                        = true
MIRROR_ENABLED                      = true
RUNTIME_MODE                        = runtime
WORKER_TRAFFIC_PERCENTAGE           = 100
ACTIVATED_REPORT_SETTING_COUNT      = 4
RETAINED_MESSAGE_COUNT              = 1
ADDITIONAL_DELIVERY_ROW_COUNT       = 0
ADDITIONAL_MESSAGE_SEND_COUNT       = 0
QUEUE_ADMISSION_APPROVED            = false
AUTOMATION_ACTIVATION_APPROVED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
WEBHOOK_ACTIVATION_APPROVED         = false
PRODUCTION                          = BLOCKED
NEXT_GATE                           = NOTIFICATION_ADMISSION_REQUIRES_SEPARATE_APPROVAL
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

## Closed scope

- แยก Runtime mode ออกจาก Controlled UAT modeสำเร็จ;
- Runtime รับเฉพาะ `lark_notification_runtime` สำหรับ non-UAT AI identity;
- Runtime ปฏิเสธ `notification-uat:*`;
- deploy Notification Runtime Worker ที่ traffic 100%;
- เปิด `ai_enabled` และ `notification_enabled` เฉพาะ Report Settings ของ Executive `1D/3D/7D/30D` จำนวน 4 รายการ;
- retained D1 delivery และ Lark Notification Log คงเดิม;
- Queue admission = 0 และ additional message send = 0;
- exact rollback ยังคงพร้อมใช้งาน.

## Still out of scope

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

## Runtime contract now active

1. Runtime ใช้ `MKT_ENV=development`, `MKT_CUSTOMER_PROFILE=integration_workspace`,
   `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`.
2. Worker mode เป็น `runtime`; `controlled_uat` และ `runtime` identities ห้ามข้ามกัน.
3. ทุก execution flag อื่นคง false.
4. Wrangler triggers คงเดิม.
5. Source `scheduled-jobs.js` ยังไม่มี `LARK_NOTIFICATION_SEND`.
6. Retained D1 delivery คง `sent/mirrored`; active lock เป็นศูนย์ ณ activation verification.
7. Controlled UAT retained row คง exactly one D1 row, one Lark Log row และ AI Run marked sent.
8. Runtime activation ทำ one Worker deploy และ exact Report Settings updates เท่านั้น.
9. Observation หลัง Activation ยืนยัน delivery/log/message count ไม่เปลี่ยน.
10. Rollback ยังคง deploy Safe Worker และคืน exact Report Settings false ได้.
11. Production คง `BLOCKED`.

## Repository verification

PR `#497` merged to main SHA `5833c558d70efcfca08d476a30449b72d8555213` after Branch Verification `#2189` passed on exact Head
`641b47ad01a50afe6a893703cf816cc85c7eb9d1`:

```text
Syntax / architecture / hygiene    PASS
Focused Meta                       PASS
Focused WooCommerce                PASS
Focused Chatwoot                   PASS
Focused TikTok                     PASS
Full Unit and Workers runtime      PASS (2,640 tests)
Report reliability                 PASS
Dependency audit                   PASS
Wrangler dry-run                   PASS
```

## Live activation result

The exact post-merge activation Terminal completed successfully:

```text
contract_version                    lark_notification_runtime_activation_v1
phase                               active
repository_head                     5833c558d70efcfca08d476a30449b72d8555213
active_worker_version               958e183e-fb0d-4795-a547-d805111ca6fc
traffic_percentage                  100
runtime_enabled                     true
send_enabled                        true
mirror_enabled                      true
runtime_mode                        runtime
activated_report_setting_count      4
delivery_rows                       1
retained_notification_messages      1
additional_delivery_rows            0
additional_message_sends            0
notification_log_rows               1
controlled_uat_sent_stable          true
queue_admission_count               0
notification_producer_enabled       false
notification_flags_active           true
report_settings_active              true
rollback_available                  true
automation_activation_count         0
schedule_activation_count           0
production                          BLOCKED
```

Runtime Activation is closed as `PASS`. Do not rerun the activation, Controlled UAT or Mirror Recovery
commands. The next permitted workstream is Notification Admission, and it requires separate explicit approval.
