# Lark Weekly 7D Executive Notification Admission v1

Date: 2026-08-08

## Objective

ส่ง Weekly Executive `7D` ที่ผ่าน Native Lark AI Technical, Content Quality และ Business Acceptance แล้ว
เข้ากลุ่ม Executive จริง **หนึ่งข้อความเท่านั้น** ผ่าน Shared Notification Runtime เดิม:

```text
accepted V9 weekly AI source (immutable)
→ dedicated notification AI identity
→ existing lark.notification.send Runtime Queue job
→ D1 atomic notification_attempt_key
→ Lark IM
→ Notification Log mirror + sent_to_group
→ bounded no-admission duplicate proof
```

งานนี้ไม่เปิด Lark Base Notification Automation, automatic producer, Cron/Schedule หรือ Production.

## Accepted source authority

Source ต้องเป็น exact finalized weekly UAT row เดิมเท่านั้น:

```text
template_version       weekly_executive_quality_v2_uat
scope_type             executive
channel_key            executive
window_days            7
generation_status      generated
failure_code           empty
preview_mode           true
notification_eligible  false
sent_to_group          false
promptShape            lark_ai_compact_quality_v6
qualityGate            PASS
```

Retained accepted business facts include:

```text
Meta Ads clicks          4553
Meta Ads impressions     582054
derived CTR percent      0.78223
```

The source row remains Preview evidence and must never be converted to sendable state in place.

## Dedicated send identity

The admission clones only the accepted source fields into a new deterministic identity:

```text
ai_run_key            notification-weekly-7d:<sha256>
report_id             same dedicated identity
template_version      executive_weekly_7d_notification_v1
notification_eligible true
notification_reason   weekly_7d_quality_accepted
preview_mode          false
generation_status     generated
sent_to_group         false before delivery
```

The identity is bound to source AI identity, source dedupe key, exact source Report IDs, retained business-evidence
checksum and four accepted output checksums. It intentionally does not depend on repository Head so a later code
revision cannot create a second notification identity for the same accepted weekly report.

## Business-first message contract

The shared renderer is upgraded to `executive_report_notification_v2`. For `7D`, the group message is:

```text
📊 Social MKT Weekly Executive Report — 7D
ช่วง <period_start> ถึง <period_end>

ภาพรวมสัปดาห์นี้
<insight_summary>

🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์
<strengths>

⚠️ สิ่งที่ต้องจับตา
<weaknesses>

🎯 สิ่งที่ควรทำสัปดาห์หน้า
<recommendations>
```

User-facing text must not include internal `report_partial`, `report_available`, `readiness_status`, `data_status`,
`สถานะข้อมูล` or severity labels. Internal readiness/severity may remain inside the checksummed delivery payload for
audit authority but are not rendered into chat text.

## Current-main Runtime refresh

The retained Runtime Worker was deployed before renderer v2. Repository-only merge is therefore insufficient to
change the text that a Queue consumer sends.

Before Queue admission the exact terminal performs one bounded current-main Runtime refresh:

1. regenerate the already-reviewed Runtime config using existing runtime helpers;
2. keep only Notification Runtime/Send/Mirror active and preserve Worker triggers exactly;
3. dry-run current-main config;
4. deploy current-main Worker once;
5. require the new version at 100% traffic;
6. re-read active Report Settings, Automations and D1 and require zero pre-admission delivery drift.

Report Settings are already active and are **read-only** in this workstream. No Settings writer exists in the
admission terminal.

## One-shot admission sequence

```text
clean exact current main
→ revalidate accepted V9 quality-v6 source
→ verify AI Automation active / Base Notification Automation inactive
→ verify Controlled UAT + Runtime Smoke terminal sent/mirrored baseline
→ verify four Executive Runtime Settings active at reviewed destination
→ deploy current-main Runtime renderer v2 once / 100% traffic
→ prove deploy itself sent nothing
→ create-or-exact-skip one dedicated notification AI row
→ render exact message locally and validate business-first text
→ write immutable Queue-attempt evidence
→ Queue POST exactly once
→ poll exact D1 delivery with transient-safe verifier
→ require sent/mirrored
→ require one exact Notification Log row and dedicated AI sent_to_group=true
→ require accepted V9 source checksum unchanged
→ observe without another Queue admission
→ require duplicateDeliveryRows=0
```

## No-blind-rerun rule

The evidence directory is keyed by SHA-256 of the stable dedicated notification identity, not by repository Head.
Once `03-queue-send.attempt.json` exists, `--execute` is permanently closed for that weekly identity.

A controller error after that point must use:

```text
--recover
```

Recovery performs D1/Lark polling only. It contains no Queue POST and no Worker deployment. A missing retained D1
attempt is a blocker, not permission to resend.

## Automation boundary

```text
AI Materialization → MKT_AI_Report_Runs
required active / exact identity

Eligible AI Run → Lark Group Notification
required inactive / exact identity
```

The Base Notification Automation is not activated. D1 atomic delivery remains the send authority.

## Safety

```text
Maximum Worker deployment             1, before Queue attempt only
Maximum Queue admission               1
Maximum message send                  1
Accepted V9 source mutation           0
Report Settings writes                0
Base Notification Automation change   0
Automatic notification producer       false
Schedule/Cron activation              0
Production                            BLOCKED
```

If the Lark transport outcome is unknown, existing D1 delivery code moves the exact attempt to `blocked_unknown` and
automatic resend remains forbidden.

## Verification

```bash
npm ci
npm run check
node --test \
  tests/application/lark-weekly-7d-notification-admission.test.js \
  tests/application/deliver-lark-executive-notification.test.js \
  tests/scripts/lark-weekly-7d-notification-admission-exact-terminal-source.test.mjs
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository implementation/CI performs no Remote Lark/Cloudflare execution. Live admission is a separate exact-main
Terminal action after merge.
