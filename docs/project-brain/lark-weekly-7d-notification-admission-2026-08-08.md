# Lark Weekly 7D Notification Admission — 2026-08-08

## Accepted AI boundary

The weekly Executive Native Lark AI path is closed as Technical + Content + Business Acceptance PASS on the exact
retained V9 row.

```text
prompt contract                  lark_native_ai_automation_prompts_v3
prompt shape                     lark_ai_compact_quality_v6
business evidence channels       1 / Meta Ads
comparison evidence channels     0
clicks                           4553
impressions                      582054
derived CTR percent              0.78223
quality gate                     PASS / zero violations
source preview_mode              true
source notification_eligible     false
source sent_to_group             false
```

The source V9 row is immutable acceptance evidence. Notification Admission must create a separate deterministic
identity and must never flip the source row itself to eligible/sent.

## Delivery architecture

The active delivery authority remains the existing Shared path:

```text
Runtime Queue
→ D1 atomic notification_attempt_key
→ Lark IM
→ Notification Log mirror
→ AI Run sent_to_group mirror
```

`Eligible AI Run → Lark Group Notification` remains an inactive Base Automation placeholder. It is not the send
authority and must not be activated.

## Business-first renderer correction

The previous Worker renderer exposed internal `severity` and `readiness_status` in chat text. Weekly Admission
therefore upgrades the shared renderer to `executive_report_notification_v2` and renders the accepted AI outputs as:

```text
📊 Social MKT Weekly Executive Report — 7D
ภาพรวมสัปดาห์นี้
🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์
⚠️ สิ่งที่ต้องจับตา
🎯 สิ่งที่ควรทำสัปดาห์หน้า
```

Internal `report_partial`, `report_available`, readiness/data-status and severity labels are forbidden from the
user-facing message.

## Runtime refresh requirement

The retained Notification Runtime Worker predates renderer v2. The single controlled admission therefore refreshes
the Runtime Worker from exact current main before Queue admission, preserving the existing Runtime flags and
Settings contract. This is one bounded Worker deployment, with zero Report Settings writes and zero Queue/message
action until the new version is verified at 100% traffic.

Once Queue-attempt evidence exists, no deploy/rollback/resend is allowed automatically. Recovery becomes poll-only.

## Retained delivery baseline

Notification Admission requires the existing successful closeout to remain intact:

```text
Controlled UAT D1 sent/mirrored       exactly 1
Runtime Smoke D1 sent/mirrored        exactly 1
Controlled UAT Lark Log               exactly 1
Runtime Smoke Lark Log                exactly 1
active locks                           0
unrelated unsafe delivery             0
Executive Runtime Settings            active / reviewed destination
AI Materialization Automation         active / exact identity
Base Notification Automation          inactive / exact identity
automatic producer / schedule         disabled
Production                             BLOCKED
```

Total delivery count is not otherwise hard-coded so later terminal, already-reviewed deliveries cannot be mistaken
for schema drift. The exact weekly identity itself must be absent before first admission.

## Permanent retry rule

The evidence directory is stable by notification identity rather than repository SHA. After the exact Queue-attempt
file is written, `--execute` must never be rerun for the same weekly report. `--recover` may only observe the retained
D1/Lark attempt and cannot deploy or POST another Queue message.

## Parallel-workstream boundary

`docs/current-task.md` remains owned by the unrelated Chatwoot Daily Partial Report Coverage workstream and is not
modified here. This Notification workstream does not alter Chatwoot, Report materialization, Provider, Business
facts, source connectors or Production.
