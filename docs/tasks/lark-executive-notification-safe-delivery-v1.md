# Lark Executive Notification Safe Delivery v1

Date: 2026-08-04  
Repository baseline: `a4d14cb5524b379f99939189d1351e452fc4aaa1`

## Objective

Replace the unsupported Lark Base Automation duplicate gate with one Shared-Core delivery path:

```text
Lark AI Run / Snapshot / Settings exact reads
→ D1 atomic notification_attempt_key claim
→ existing shared Queue job
→ single-attempt Lark IM send
→ D1 sent or blocked_unknown terminal state
→ idempotent Lark Notification Log mirror
```

The Lark Base Automation `Eligible AI Run → Lark Group Notification` stays an inactive one-minute placeholder and is not part of delivery.

## Root cause

The confirmed tenant UI for `Find records` can stop only when no records are found. It cannot express:

```text
matching notification_attempt_key exists → stop
no matching record → continue
```

Saving a Lark Automation chain without that gate could send duplicates. The repository therefore moves exact-send authority to D1, where an atomic SQL statement can arbitrate one claim across Worker invocations.

## Shared Core reused

- existing `JOB_TYPES.LARK_NOTIFICATION_SEND`
- existing main Queue, retry classification, DLQ and System Alert routing
- existing Worker route chain and lazy infrastructure factory
- existing Lark Bitable client/token cache
- existing `LarkRecordRepository`
- existing `TableSyncEngine` for Notification Log mirror
- existing D1 runtime authority pattern

No second Queue framework, Reliability engine, generic D1 writer, Lark sync engine, Scheduler or external provider was created.

## Migration 0019

`migrations/0019_lark_notification_delivery.sql` adds one runtime authority table:

```text
lark_notification_deliveries
```

Stable identity:

```text
notification_attempt_key = ai_run_key :: dedupe_key
UNIQUE(ai_run_key, dedupe_key, destination_key_hash)
```

Only an expired `claimed` row may be reclaimed. The statuses `sending`, `sent`, `blocked` and `blocked_unknown` are never automatically reclaimed.

## Exact-send state machine

```text
absent
→ claimed
→ sending
→ sent
```

Unknown outcome:

```text
sending
→ blocked_unknown
→ no automatic resend
```

Mirror repair:

```text
sent + mirror pending/failed
→ replay exact attempt
→ no message send
→ retry only Notification Log mirror
```

If a remote message is confirmed, only its SHA-256 ID hash may be stored. Raw group ID and raw message ID are excluded from D1 evidence and logs.

## Runtime gates

All gates default false and are independent:

```text
MKT_NOTIFICATION_RUNTIME_ENABLED=false
MKT_NOTIFICATION_LARK_SEND_ENABLED=false
MKT_NOTIFICATION_LARK_MIRROR_ENABLED=false
```

The Queue job remains manual-only with trigger:

```text
lark_notification_controlled_uat
```

No producer, Cron or Base Automation activation is added.

## Repository preview

```bash
node scripts/lark-executive-notification-safe-delivery-preview.mjs
```

Expected result:

```text
contractVersion  lark_executive_notification_safe_delivery_v1
status           repository_safe_delivery_ready_remote_rollout_blocked
blockerCount     0
remoteActionCount 0
production       BLOCKED
```

## Separate post-merge gates

1. backup and separately approve/apply Migration 0019;
2. configure existing table mapping for `🔔 MKT_Notification_Log` and keep all three flags false;
3. deploy one all-false Worker version and run read-only readiness;
4. separately approve one controlled Queue message and one group message UAT;
5. verify exact D1 attempt, Lark Notification Log mirror and replay with `messageSendCount=0`;
6. separately approve activation. No schedule is part of v1.

## Repository implementation safety

```text
Remote Lark read/write       0 / 0
Remote D1 read/write         0 / 0
Migration apply              0
Queue send                   0
Worker deployment            0
AI call                      0
Notification send            0
Automation activation        0
Schedule                     disabled
Production                   BLOCKED
```
