# Current Task — Lark Notification Runtime Smoke Test v1

## Status

```text
TASK_STATUS                         = PR_READY_FOR_FINAL_EXACT_HEAD_CI
CURRENT_PROGRAM                     = LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_V1
BRANCH                              = feat/lark-notification-runtime-smoke-test-v1
BASE_MAIN_SHA                       = 3b02ac90b5912a8a1d2f4fd9b06a8ab1163ed7c4
RUNTIME_ACTIVATION                  = CLOSED_PASS
ACTIVE_WORKER_VERSION               = 958e183e-fb0d-4795-a547-d805111ca6fc
WORKER_TRAFFIC_PERCENTAGE           = 100
RUNTIME_MODE                        = runtime
ACTIVATED_REPORT_SETTING_COUNT      = 4
RUNTIME_SMOKE_TEST_APPROVED         = true
MAXIMUM_MANUAL_QUEUE_ADMISSION      = 1
AUTOMATIC_QUEUE_ADMISSION_APPROVED  = false
AUTOMATION_ACTIVATION_APPROVED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
WEBHOOK_ACTIVATION_APPROVED         = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/lark-notification-runtime-smoke-test-v1.md
```

## Objective

ทดสอบ Worker-side Lark Executive Notification Runtime ที่เปิดใช้งานแล้วด้วยข้อความจริงหนึ่งข้อความ โดยสร้าง
AI Run identity ใหม่จาก latest reviewed Executive `1D` Preview, ส่ง `lark_notification_runtime` Queue job
แบบ Manual exactly one ครั้ง และพิสูจน์ D1 sent/mirrored กับ Lark Notification Log parity โดยไม่ Deploy
Worker ใหม่ ไม่แก้ Report Settings และไม่เปิด Producer/Automation/Schedule/Webhook/Production.

## In scope

- ใช้ Runtime Worker version `958e183e-fb0d-4795-a547-d805111ca6fc` ที่ traffic 100%;
- ตรวจ Executive `1D/3D/7D/30D` Settings ทั้ง 4 รายการยัง active และ destination hash ตรง;
- เลือก latest exact Executive `1D` Preview เป็น source evidence;
- สร้าง dedicated identity `notification-runtime-smoke:<sha256>` โดยไม่แก้ Preview เดิม;
- admit Queue job trigger `lark_notification_runtime` exactly one ครั้ง;
- ตรวจ delivery rows `1 -> 2`, exact smoke delivery = one `sent/mirrored`;
- ตรวจ Lark Notification Log `1 -> 2` และ AI Run marked sent;
- ทำ bounded observation โดยไม่ admit งานเพิ่มและพิสูจน์ duplicate delivery = 0;
- เก็บ private one-shot evidence ก่อน Queue POST และห้าม blind rerun หลัง attempt evidence.

## Out of scope

- Controlled UAT replay หรือ Mirror Recovery เดิม;
- Runtime Activation command เดิมหรือ Worker deployment ใหม่;
- second Queue admission/replay สำหรับ smoke identity;
- Notification discovery/dispatcher/automatic producer;
- Lark Automation;
- Cron/Schedule notification producer;
- Webhook/HTTP admission;
- AI provider, AI Worker หรือ custom model runtime;
- Report Settings mutation;
- Production profile/assets;
- Connector, Queue, D1, Lark หรือ Reliability engine ใหม่.

## Preserved parallel authority

Meta retained recovery authority remains unchanged. The only permitted Meta current-recovery entrypoint remains:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

This Runtime Smoke Test does not invoke, replace or authorize that Meta Terminal, Provider replay, D1 Queue
resend, Lark Business mutation or Production action.

## Contract

1. Runtime ใช้ `MKT_ENV=development`, `MKT_CUSTOMER_PROFILE=integration_workspace`,
   `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`.
2. Repository execution ต้องเป็น clean exact current `main`.
3. Active Worker ต้องเป็น reviewed version `958e183e-fb0d-4795-a547-d805111ca6fc` ที่ traffic 100%.
4. Worker mode ต้องคง `runtime`; smoke identity ห้ามใช้ `notification-uat:*`.
5. Executive source authority ต้องมี latest reviewed Preview ครบ `1D/3D/7D/30D` และ exact Settings
   ทั้ง 4 รายการต้อง active พร้อม destination hash เดียวกัน.
6. Smoke ใช้ latest `1D` Preview และสร้าง AI row ใหม่เท่านั้น; ห้ามแก้ Preview หรือ Business facts เดิม.
7. ก่อน admission ต้องมี notification schema `1 table / 3 indexes`, active lock = 0, retained Controlled
   UAT exactly one `sent/mirrored`, unsafe delivery = 0 และ exact smoke delivery = 0.
8. Queue mutation อนุญาตเพียง one exact REST admission หลังเขียน immutable attempt evidence.
9. หลัง admission ต้องมี total delivery เพิ่มหนึ่ง, exact smoke delivery one `sent/mirrored`, one new Lark
   Notification Log row และ AI Run marked sent.
10. Observation ต้องไม่มี Queue admission เพิ่ม, claim/delivery/log/message evidence ต้องคงเดิม และ
    duplicate delivery = 0.
11. Smoke Test ไม่ Deploy Worker, ไม่แก้ Report Settings, ไม่เปิด Automation/Schedule/Webhook และไม่อนุมัติ
    automatic Notification Admission.
12. หาก Queue attempt evidence ถูกเขียนแล้ว ห้าม blind rerun แม้ผล REST/transport ไม่ชัดเจน.
13. Production คง `BLOCKED`.

## Required verification

```bash
npm ci
npm run check
node --test \
  tests/application/lark-notification-runtime-smoke-test.test.js \
  tests/application/lark-notification-runtime-smoke-test-exact-terminal.test.js \
  tests/application/lark-notification-active-job-router.test.js \
  tests/application/deliver-lark-executive-notification.test.js \
  tests/connectors/lark-notification-delivery-source.test.js \
  tests/connectors/d1-lark-notification-delivery-store.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Repository implementation is complete on PR `#499`.

Implemented:

- deterministic non-UAT Runtime smoke identity bound to exact repository Head and reviewed `1D` Preview;
- stable Queue job using the existing `lark.notification.send` type and `lark_notification_runtime` trigger;
- exact preflight for reviewed active Worker version, four active Settings, destination, D1 terminal state and
  retained Controlled UAT;
- one exact Terminal with one Queue POST maximum and immutable attempt evidence before admission;
- exact D1 and Lark parity requiring one new sent/mirrored delivery, one new Notification Log row and AI sent marker;
- bounded no-admission observation proving no duplicate delivery without a second Queue send;
- explicit zero Worker deployment, zero Report Settings writes and zero Automation/Schedule/Webhook/Production;
- focused contract and static Terminal safety regressions;
- task and Project Brain authority documentation.

The feature branch was aligned with current `main` through PR `#500`; it is `behind_by=0`.

Branch Verification `#2194` passed on aligned implementation Head
`e1e3796c9df1a69d3c28357a69ff0c2625a587f3`:

```text
Syntax / architecture / hygiene    PASS
Focused Meta                       PASS
Focused WooCommerce                PASS
Focused Chatwoot                   PASS
Focused TikTok                     PASS
Full Unit and Workers runtime      PASS
Report reliability                 PASS
Dependency audit                   PASS
Wrangler dry-run                   PASS
```

Remote actions from this implementation branch remain:

```text
Worker deployment                  0
Remote Lark Record write           0
Remote D1 write                    0
Queue admission                    0
Notification send                 0
Lark Automation activation         0
Schedule/Cron activation           0
Webhook activation                 0
Production action                  0
```

Live smoke execution remains a single post-merge exact-main Terminal action after final exact-head CI and review.
