# Lark Executive Notification Remote Rollout Readiness v1

Date: 2026-08-04

## Status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTED_CI_PENDING
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

Before any Remote mutation, the operator checks live D1 `sync_work_runs` and `sync_locks`. Repository preparation continues independently. Any active work or non-expired lock stops before backup or Migration.

## Reused Shared Core

- existing Migration `0019_lark_notification_delivery.sql`;
- existing Wrangler/D1 migration and backup sequence used by the current Remote readiness operators;
- existing Integration Workspace D1, Queue and DLQ topology;
- existing Lark notification Runtime config and destination hash;
- existing central `JOB_TYPES`, `JOB_TRIGGERS`, schema version and stable Queue operation builder;
- existing `.dev.vars` parser.

No second Queue framework, D1 writer, Lark client, delivery engine, Scheduler or generic operator framework was added.

## Implemented operator

```text
scripts/lib/lark-notification-remote-rollout-operator.js
scripts/lark-notification-remote-rollout-operator.mjs
tests/application/lark-notification-remote-rollout-operator.test.js
```

Default execution is plan-only:

```bash
node scripts/lark-notification-remote-rollout-operator.mjs
```

Implemented executable phases use distinct exact confirmations:

```text
preflight
backup
migrate
schema-readback
```

The operator intentionally has no Worker deploy, Queue send, Lark write, message send, Automation activation or Schedule path. Those remain separate post-Migration gates.

## Required rollout phases

1. `preflight`
   - clean merged `main` containing PR #472;
   - exact Migration 0019 source audit;
   - exact all-false notification flags and required Lark table mappings;
   - current Remote migration inventory;
   - live D1 active-work/active-lock check;
   - zero Remote mutation.

2. `backup`
   - fresh Remote D1 export and SHA-256;
   - evidence bound to the exact target and Migration source.

3. `migrate`
   - apply only Migration 0019;
   - requires exact preflight and backup evidence.

4. `schema-readback`
   - exact one table and three indexes;
   - zero notification delivery rows;
   - zero active work/locks;
   - Shared Business fact counts unchanged.

5. Later separate approvals
   - safe all-false Worker deploy;
   - one controlled Queue admission and one group message;
   - replay verification with `messageSendCount=0`;
   - all-false restore;
   - activation remains separate and no Schedule is part of v1.

## Fail-closed boundaries

- Never auto-retry `sending` or `blocked_unknown`.
- Never persist raw Lark group ID or raw message ID in evidence/logs.
- Never use the inactive Base notification Automation as a delivery fallback.
- Never send a second Queue admission for the same `notification_attempt_key` during controlled UAT.
- Never enable a Schedule in v1.
- Do not infer Remote ownership from `docs/current-task.md` alone.
- Stop before Remote mutation when live D1 proves active work or a non-expired lock.
- Require a clean `main` containing the merged safe-delivery baseline.

## Verification

```bash
npm ci
npm run check
node --test tests/application/lark-notification-remote-rollout-operator.test.js
node --test tests/application/lark-notification-active-job-router.test.js
node --test tests/connectors/d1-lark-notification-delivery-store.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Current action result

Repository implementation only. No Remote command was executed.

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
