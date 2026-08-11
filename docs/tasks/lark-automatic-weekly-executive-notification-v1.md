# Task — Lark Automatic Weekly Executive Notification v1

## Status

```text
CURRENT_PROGRAM                    = LARK_AUTOMATIC_WEEKLY_EXECUTIVE_NOTIFICATION_V1
WORKSPACE                          = integration_workspace
ONE_SHOT_WEEKLY_DELIVERY           = CLOSED_PASS_DO_NOT_RERUN
AUTOMATIC_WEEKLY_APPROVAL          = EXPLICITLY_APPROVED_2026_08_11
IMPLEMENTATION_PR                  = MERGED_630
SOURCE_SETTINGS_HOTFIX_PR          = MERGED_633
LIVE_ACTIVATION                    = PASS_ENABLED
ACTIVE_WORKER_VERSION              = f19492d2-67f4-4b7c-ba78-3bb84fb439e8
WORKER_TRAFFIC                     = 100_PERCENT
AUTOMATIC_WEEKLY_NOTIFICATION      = ENABLED_MONDAY_0830_ASIA_BANGKOK
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

## Live activation closeout — 2026-08-11

### Repository release

```text
Original implementation PR         = #630
Original merge SHA                 = 8aba0b5dc112d96b37bc6522efc0443000ce046d
Source Settings authority hotfix   = #633
Hotfix merge SHA                   = 89f9c615f2ae20f798b089e639c3d9dd5f1cb38a
Hotfix exact-head CI               = PASS
```

The first live preview after PR #630 failed read-only with
`LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID` and `matchCount=0`. Root cause was an
integration-boundary shape mismatch: the activation terminal passed flattened builder settings to a resolver
that intentionally requires raw Lark records under `record.fields.*`. PR #633 corrected only that boundary by
reading exact canonical `report_setting_key` rows through the existing `LarkRecordRepository`.

### Partial activation and deploy recovery

The first execute after the authority hotfix activated three exact 7D Report Setting rows, then Cloudflare
rejected the new Worker version because `apps/sync-worker/src/lark-weekly-executive-auto.js` imports
`node:crypto` while the ignored active Wrangler config did not yet enable Node compatibility.

```text
settingsWriteCount                 = 3
workerDeploymentCount              = 0
deployAttempted                    = true
queueAdmissionCount                = 0
messageSendCount                   = 0
baseNotificationAutomationActivated = false
Production                         = BLOCKED
```

Because the deploy attempt had begun, the guarded operator correctly avoided blind rollback. Recovery preserved
the now-active exact Report Settings, added `nodejs_compat` to the ignored active `wrangler.sync.jsonc`, reran
preview against the current authority, and executed from that state. Future deployments of the current runtime
must preserve Node compatibility while this Worker path imports `node:crypto`.

### Verified live result

```text
status                              = automatic_weekly_executive_notification_enabled
repository main                     = 89f9c615f2ae20f798b089e639c3d9dd5f1cb38a
active Worker version               = f19492d2-67f4-4b7c-ba78-3bb84fb439e8
traffic                             = 100 percent
activation source period            = 2026-08-04..2026-08-10
source Report count                 = 8
source Settings before recovery     = active
source Settings active after        = true
recovery settingsWriteCount         = 0
Notification runtime                = enabled
Notification send                   = enabled
Notification mirror                 = enabled
runtime mode                        = runtime
Automatic Weekly                    = enabled
Weekly notification time            = 08:30 Asia/Bangkok
AI Materialization Automation       = enable
Base Notification Automation        = disable
immediate Queue admissions          = 0
immediate Lark message sends        = 0
recovery workerDeploymentCount      = 1
Production                          = BLOCKED
```

Activation did not send a manual/test message. The first eligible automatic cycle after activation is Monday
`2026-08-17 08:30 Asia/Bangkok`, targeting the exact fresh Weekly period `2026-08-10..2026-08-16`. Missing,
stale, incomplete, AI-failed or Quality-Gate-failed source state must continue to fail closed; an older Weekly
message must never be substituted.
