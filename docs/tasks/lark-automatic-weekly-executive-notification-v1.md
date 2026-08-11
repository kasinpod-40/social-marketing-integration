# Task — Lark Automatic Weekly Executive Notification v1

## Status

```text
CURRENT_PROGRAM                    = LARK_AUTOMATIC_WEEKLY_EXECUTIVE_NOTIFICATION_V1
WORKSPACE                          = integration_workspace
ONE_SHOT_WEEKLY_DELIVERY           = CLOSED_PASS_DO_NOT_RERUN
AUTOMATIC_WEEKLY_APPROVAL          = EXPLICITLY_APPROVED_2026_08_11
IMPLEMENTATION_BRANCH              = agent/automatic-weekly-executive-notification-v1
LIVE_ACTIVATION                    = PENDING_REVIEWED_MERGE
PRODUCTION                         = BLOCKED
```

## Objective

ส่ง Weekly 7D Executive Report เข้ากลุ่ม Lark อัตโนมัติทุกสัปดาห์หลัง Weekly Shared Report materialization โดย reuse Fresh Executive Native AI, Decision Quality Gate และ Shared Notification Runtime ที่พิสูจน์ one-shot จริงแล้วทั้งหมด.

## Required behavior

1. Weekly Shared Report ยังคงรัน Monday 08:15 Asia/Bangkok.
2. Automatic Weekly Executive orchestration รัน Monday 08:30 Asia/Bangkok.
3. Job identity ผูกกับ previous completed Bangkok day และ stable operation ID ของ period นั้น.
4. Source ต้องตรง exact scheduled 7D period และมี Report ครบทุก reviewed active platform.
5. Fresh Executive AI row ใช้ deterministic identity ใหม่ของ period นั้น; ห้าม reuse historical sent identity.
6. Trigger เฉพาะ existing `AI Materialization → MKT_AI_Report_Runs` ผ่าน field contract เดิม.
7. Base `Eligible AI Run → Lark Group Notification` ต้อง OFF ตลอด.
8. Output ต้องผ่าน unchanged Executive Decision Quality Gate ก่อนสร้าง dedicated sendable AI row.
9. Delivery ใช้ existing `lark.notification.send` + D1 atomic claim + Lark mirror เท่านั้น.
10. Production คง BLOCKED.

## Failure contract

- Report ยังไม่ครบ: transient bounded retry; ห้าม fallback สัปดาห์เก่า.
- Report period ใหม่กว่า scheduled identity: permanent drift.
- AI trigger outcome uncertain: permanent block; blind retrigger forbidden.
- AI generation failed/timeout: terminal evidence; no notification Queue admission.
- Admission row create outcome uncertain: permanent block; blind recreate forbidden.
- Queue admission transport failure: bounded retry; downstream duplicate Queue admission remains safe because D1 claim is exact-once.
- Lark message outcome unknown: preserve existing `blocked_unknown`; automatic resend forbidden.
- Lark mirror failure after sent: retry mirror only; never resend chat message.

## Activation gate

After exact-head CI, review and merge, one guarded Integration Workspace activation may:

- leave current Source/Report execution flags unchanged;
- enable Notification runtime/send/mirror in runtime mode;
- enable `MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED`;
- set Weekly Notification time to 08:30;
- activate only exact current 7D source Report Settings that are inactive, until all reviewed 7D source Settings have matching `ai_enabled=true` and `notification_enabled=true`;
- preserve existing reviewed destination state without writing `group_id` into unset rows;
- keep AI Materialization Automation ON;
- keep Base Notification Automation OFF;
- deploy reviewed Worker and verify 100% traffic;
- perform no immediate Queue admission or group send during activation.

## Required repository gates

```bash
npm ci
npm run check
node --test \
  tests/application/lark-weekly-executive-scheduled-job.test.js \
  tests/application/lark-weekly-executive-auto-router.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Acceptance criteria

- scheduler emits exactly one automatic orchestration job only at the reviewed weekday/time;
- automatic schedule cannot be enabled while Weekly Report/runtime/send/mirror gates are inconsistent;
- automatic job never directly contains raw Lark destination/message text;
- Fresh source period exact-match and full reviewed-platform coverage are enforced;
- Native AI trigger/recreate uncertainty is fail-closed;
- unchanged Quality Gate is mandatory;
- dedicated notification identity is deterministic and future-period-specific;
- ordinary one-shot/runtime notification routing remains unchanged;
- D1 exact-once delivery remains the final duplicate authority;
- repository default automatic flag remains false;
- Live activation performs zero immediate notification sends;
- next expected eligible period after approval is `2026-08-10..2026-08-16`.
