# Lark Notification Sent Mirror Recovery v1

Date: 2026-08-05

## Incident

The controlled Executive notification UAT reached the real Lark group exactly once and persisted the authoritative D1 delivery as:

```text
delivery_rows        1
delivery_status      sent
mirror_status        failed
safe_worker_restored true
report_settings      restored false
automation_active    0
schedule_activation  0
production           BLOCKED
```

The original controlled-UAT terminal then timed out while waiting for `mirror_status=mirrored` and stopped before its planned replay. The original command must not be run again because a real Queue attempt and one real group message already exist.

## Root cause

`loadLarkNotificationDeliveryRequest()` correctly normalizes source Report periods to date-only values such as `2026-08-03`. The Notification Log physical schema defines `period_start` and `period_end` as Lark `DateTime`, while the shared DateTime serializer accepts epoch values or ISO-8601 values with an explicit timezone and intentionally rejects bare date-only strings.

The first message was therefore sent and marked `sent` in D1, then Notification Log preflight failed before the mirror could reconcile. Existing D1 exactly-once authority behaved correctly and prevented the mirror error from changing the sent evidence.

## Correction

The Worker router now uses a narrow notification-mirror adapter that converts only the two Report date-only fields to Asia/Bangkok midnight epoch milliseconds before invoking the existing `createLarkNotificationStateMirror`, `TableSyncEngine` and Lark serializer.

No generic DateTime behavior, Report identity, delivery claim, transport or Lark schema is changed.

## Recovery contract

The exact recovery terminal:

1. discovers exactly one retained `notification-uat:*` delivery with `status=sent` and `mirror_status=failed`;
2. records the retained redacted mirror error and partial Lark state;
3. requires no active D1 lock and preserves the original `sent_at` and message ID hash;
4. temporarily enables only the exact source Report Settings;
5. deploys the existing notification-only active Worker window with every other execution flag false;
6. submits one Queue replay for the same AI/dedupe delivery identity;
7. relies on the existing D1 terminal-sent claim path, which cannot call the message transport and only repairs the mirror;
8. requires `claim_count` to increase exactly once, `mirror_status=mirrored`, one Notification Log row, and the AI Run sent marker;
9. restores the all-false Worker and exact Report Settings false in `finally`.

The recovery contains no direct D1 lifecycle SQL mutation and no direct Lark message-send call.

## Post-merge exact terminal

Run once only:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NOTIFICATION_MIRROR_RECOVERY=REPAIR_SENT_EXECUTIVE_MIRROR_WITHOUT_RESEND \
node scripts/lark-notification-controlled-uat-mirror-recovery-exact-terminal.mjs --execute
```

Do not run the original controlled-UAT command again. Do not repeat the recovery command after its Queue-attempt evidence file exists.

## Acceptance

```text
retained_notification_message_count  1
additional_message_send_count        0
delivery_rows                        1
delivery_status                      sent
mirror_status                        mirrored
claim_count                          previous + 1
sent_at                              unchanged
message_id_hash                      unchanged
notification_log_rows                1
ai_run_marked_sent                    true
notification_flags_after_closeout    all false
report_settings_after_closeout       false
automation_activation_count          0
schedule_activation_count            0
production                           BLOCKED
```

## Live closeout — PASS

Executed on exact `main`:

```text
repository_head                       2a73de054b3918b32a2cfead772b726d10bff205
active_worker_version                 3b6a9013-29aa-4e5f-b580-56c4fb667e11
safe_worker_version                   a1b290e7-797f-4e01-a729-3b8a9428587d
traffic_percentage                    100
retained_notification_message_count   1
additional_message_send_count         0
delivery_rows                         1
delivery_status                       sent
mirror_status                         mirrored
claim_count                           4 -> 5
original_sent_at_stable               true
original_message_id_hash_stable       true
notification_log_rows                 1
ai_run_marked_sent                     true
notification_flags_after_closeout     all false
report_settings_restored              true
automation_activation_count           0
schedule_activation_count             0
production                            BLOCKED
```

Result: `CONTROLLED_EXECUTIVE_NOTIFICATION_UAT_CLOSED_PASS`.

The original controlled-UAT command and the mirror-recovery command are both permanently closed for this retained identity. Any future notification runtime activation must be a separate reviewed workstream with separate approval; this closeout does not authorize Runtime, Automation, Schedule, Cron, Webhook or Production activation.
