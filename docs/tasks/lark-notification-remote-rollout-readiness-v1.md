# Lark Executive Notification Remote Rollout Readiness v1

Date: 2026-08-04

## Status

```text
TASK_STATUS                         = REPOSITORY_ONLY_STAGED
CURRENT_PROGRAM                     = LARK_NOTIFICATION_REMOTE_ROLLOUT_READINESS_V1
BASE_AUTHORITY                      = PR_472_MERGED
SAFE_DELIVERY_MAIN_COMMIT           = e1ebf03246ffdb09c9e70b78a01c350202127ce0
REMOTE_D1_MIGRATION                 = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_SEND                          = NOT_RUN
LARK_WRITE                          = NOT_RUN
NOTIFICATION_SEND                   = NOT_RUN
AUTOMATION_ACTIVE                   = 0
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Objective

Prepare the separately approved Remote rollout for the merged atomic Lark executive notification delivery while preserving every existing safety boundary.

Reviewed delivery path:

```text
AI Run / Snapshot / Settings exact reads
→ D1 atomic notification_attempt_key claim
→ existing shared Queue job
→ one Lark group message
→ D1 sent or blocked_unknown terminal state
→ idempotent Lark Notification Log mirror
```

The Lark Base notification Automation remains an inactive placeholder and is not part of delivery.

## Corrected Remote ownership rule

Chatwoot data completion and Chatwoot Report readiness do not block this workstream. A stale or unrelated entry in `docs/current-task.md` is not sufficient evidence that Chatwoot owns the current Remote Worker/D1/Queue window.

Before any Remote mutation, the operator must verify the actual current Remote owner from live retained lock/evidence and the exact active integration workstream. Repository preparation may continue independently.

At the time this task was corrected, the open Meta integration workstream records that the Meta Remote lock remains held. Therefore only Remote mutation—not Repository implementation—is deferred until that exact lock is released or handed off.

## Required rollout phases

Each phase must be independently gated and evidence-bound:

1. `read-only-preflight`
   - exact clean merged `main`;
   - Migration `0019_lark_notification_delivery.sql` source hash;
   - current Remote D1 migration inventory;
   - current Worker version and all notification flags false;
   - exact Lark table mappings present;
   - Base Automations remain Active `0`;
   - identify the actual Remote owner from current retained evidence;
   - zero Provider, Queue, D1 write, Lark write or message action.

2. `backup`
   - fresh Remote D1 export and SHA-256;
   - no Worker, Queue, Lark or message mutation.

3. `migrate-0019`
   - apply only Migration 0019;
   - schema read-back for `lark_notification_deliveries`;
   - all notification flags remain false.

4. `deploy-safe`
   - deploy reviewed Worker with all notification flags false;
   - verify no automatic producer, Cron or Base Automation activation.

5. `controlled-uat`
   - separately select exactly one eligible executive `ai_run_key`;
   - enable only the minimum notification runtime/send/mirror window;
   - submit exactly one manual `lark.notification.send` Queue job with trigger `lark_notification_controlled_uat`;
   - expect one group message and one D1 attempt.

6. `verify-and-replay`
   - D1 status `sent`;
   - exact Notification Log mirror;
   - same-operation replay returns `messageSendCount=0`;
   - no duplicate group message.

7. `restore-all-false`
   - all notification flags false;
   - no Schedule or automatic producer;
   - Base Automations Active `0`;
   - Production remains blocked pending separate activation approval.

## Fail-closed boundaries

- Never auto-retry `sending` or `blocked_unknown`.
- Never persist raw Lark group ID or raw message ID in evidence/logs.
- Never use the inactive Base notification Automation as a delivery fallback.
- Never send a second Queue admission for the same `notification_attempt_key` during controlled UAT.
- Never enable a Schedule in v1.
- Do not infer Remote ownership from `docs/current-task.md` alone.
- Stop before Remote mutation only when current retained evidence proves another workstream holds the exact Remote window.

## Current action result

This branch and task record were created only to stage the next safe workstream. No Remote command was executed.

```text
Remote D1 read/write       0 / 0
Migration apply            0
Worker deployment          0
Queue send                 0
Lark read/write            0 / 0
Notification send          0
Automation status change   0
Schedule                    disabled
Production                  BLOCKED
```

## Next repository implementation

Add a plan-only-by-default operator that enforces the phases and exact confirmations above, reuses existing Wrangler/D1/Queue/Lark helpers, records sanitized evidence, and checks the actual current Remote lock instead of treating Chatwoot or `docs/current-task.md` as a blanket blocker.
