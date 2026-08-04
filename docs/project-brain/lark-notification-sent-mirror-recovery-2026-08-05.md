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

Authoritative task document:

```text
docs/tasks/lark-notification-sent-mirror-recovery-v1.md
```
