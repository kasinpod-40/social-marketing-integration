# Lark Executive Notification Safe Delivery — 2026-08-04

## Locked decision

Lark Base Automation is retained for AI materialization only. Executive group delivery is owned by the existing Worker/Queue/D1 Shared Core because the current Base Automation tenant cannot stop when a matching Notification Log record already exists.

```text
AI Materialization Base Automation
→ inactive configured

Notification Base Automation
→ inactive placeholder

Executive Notification delivery
→ Shared Queue + D1 atomic claim + Lark IM + Lark Log mirror
```

## Atomic authority

`notification_attempt_key = ai_run_key :: dedupe_key` is the D1 primary key.

Only `claimed` may be reclaimed after lease expiry. `sending` is non-reclaimable because a crash or timeout can happen after the remote system accepted the message. Such outcomes become `blocked_unknown`, require reconciliation and never auto-resend.

A `sent` replay may repair the Lark Notification Log mirror but must return `messageSendCount=0`.

## Data minimization

- raw Lark group ID is loaded only in Worker memory from exact Settings;
- destination evidence stores SHA-256 only;
- raw remote message ID is not persisted;
- D1 stores a message ID hash only after a confirmed send;
- Notification Log stores the canonical payload checksum, not a fabricated or reused dedupe hash;
- operational errors are redacted before D1 persistence.

## Runtime boundary

Three independent flags remain false by default:

```text
MKT_NOTIFICATION_RUNTIME_ENABLED
MKT_NOTIFICATION_LARK_SEND_ENABLED
MKT_NOTIFICATION_LARK_MIRROR_ENABLED
```

The job is manual-only. No schedule or automatic producer is created. Migration 0019, Worker deployment, controlled UAT and activation require separate approvals.

## Current safe live state

```text
AI Materialization → MKT_AI_Report_Runs
Inactive / configured

Eligible AI Run → Lark Group Notification
Inactive / placeholder

Active Base Automations
0
```
