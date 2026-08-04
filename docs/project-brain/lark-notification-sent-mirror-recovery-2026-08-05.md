# Lark Notification Sent Mirror Recovery — 2026-08-05

## Permanent lesson

A confirmed `status=sent` D1 delivery is the notification authority even when its Lark customer-facing mirror fails. Never rerun the original first-send operator after this boundary.

The verified failure was caused by a physical-type mismatch at the mirror boundary:

```text
Domain Report period     YYYY-MM-DD
Notification Log fields  Lark DateTime
Shared serializer        epoch or timezone-explicit ISO only
```

Keep Report periods as date-only in the domain. Convert them only in the Notification Log mirror adapter to Asia/Bangkok midnight epoch milliseconds. Do not weaken the generic DateTime serializer and do not change the physical Lark field type.

Recovery must reuse the existing D1 terminal-sent claim and `createLarkNotificationStateMirror` path. A sent replay may repair the mirror but may never call the message transport. Completion proof requires stable original `sent_at` and message hash, one additional claim observation, one Notification Log row, the AI Run sent marker, all notification flags restored false, Report Settings restored false, no Automation activation, no Schedule activation and Production blocked.

## Verified live closeout

```text
contract_version                      lark_notification_controlled_uat_mirror_recovery_v1
repository_head                       2a73de054b3918b32a2cfead772b726d10bff205
retained_notification_message_count   1
additional_message_send_count         0
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

The Controlled Executive Notification UAT is closed as `PASS`. Both the original UAT command and the retained mirror-recovery command are permanently closed for this identity.

The next gate is not another UAT replay. It is a new, separately reviewed Runtime Activation workstream. Until that workstream is explicitly approved, Notification Runtime, Lark Automation, Cron/Schedule, Webhook and Production remain disabled or blocked.

Authoritative task document:

```text
docs/tasks/lark-notification-sent-mirror-recovery-v1.md
```
