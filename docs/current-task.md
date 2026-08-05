# Current Task — Lark Notification Runtime Smoke Poll Recovery v1

## Status

```text
TASK_STATUS                         = HOTFIX_IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = LARK_NOTIFICATION_RUNTIME_SMOKE_POLL_RECOVERY_V1
BRANCH                              = hotfix/lark-notification-runtime-smoke-poll-recovery-v1
SMOKE_EXECUTION_MAIN_SHA            = 9ca8091a3e258813793f88499d931b2f9da62a59
RUNTIME_ACTIVATION                  = CLOSED_PASS
ACTIVE_WORKER_VERSION               = 958e183e-fb0d-4795-a547-d805111ca6fc
RUNTIME_SMOKE_QUEUE_ADMISSION       = CONFIRMED_EXACTLY_ONE
LARK_MESSAGE_RECEIVED               = true
ORIGINAL_FAILURE_STAGE              = poll-sent-and-mirrored
ORIGINAL_FAILURE_CODE               = LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_REMOTE_STATE_INVALID
BLIND_RERUN_ALLOWED                 = false
RECOVERY_QUEUE_ADMISSION_APPROVED   = false
WORKER_DEPLOYMENT_APPROVED          = false
REPORT_SETTING_WRITE_APPROVED       = false
AUTOMATION_ACTIVATION_APPROVED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
WEBHOOK_ACTIVATION_APPROVED         = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/lark-notification-runtime-smoke-poll-recovery-v1.md
```

## Incident

The approved Runtime Smoke Test admitted exactly one `lark_notification_runtime` Queue job. Cloudflare confirmed
that admission, and the reviewed Executive `1D` notification was received in the Lark group. The local exact
Terminal then stopped at `poll-sent-and-mirrored` with:

```text
invalid = unsafeDeliveryRows, terminalParity
queueAttemptRecorded = true
queueAdmissionCount = 1
queueOutcomeUncertain = false
blindRerunAllowed = false
workerDeploymentCount = 0
reportSettingWriteCount = 0
production = BLOCKED
```

This is not a send failure. The message transport completed. The retained Queue attempt must never be replayed.

## Root cause

`readD1State()` called the final-state smoke normalizer on every poll. That normalizer correctly requires every
notification delivery to already be `sent/mirrored`, but the first poll can legitimately observe the exact new
smoke row in `claimed`, `sending`, or `sent` while its mirror is still pending. The poller therefore failed on a
normal transient state before it could wait for terminal parity.

## Recovery scope

- discover exactly one incomplete retained smoke evidence directory;
- bind the original preflight and Queue-attempt files to the original repository Head;
- resolve the exact Lark smoke AI identity by the persisted SHA-256 hash;
- tolerate at most one unsafe delivery only when it is the exact retained smoke row in a reviewed transient state;
- poll D1 until that existing row is `sent/mirrored`;
- verify one exact Lark Notification Log row and AI Run `sent_to_group=true`;
- observe stability without another Queue admission or replay;
- write the canonical smoke summary into the retained evidence chain.

## Permanently forbidden in recovery

- rerunning `scripts/lark-notification-runtime-smoke-test-exact-terminal.mjs --execute`;
- any Queue POST, replay, resend or replacement smoke identity;
- Worker deployment;
- Report Settings mutation;
- Controlled UAT or Mirror Recovery reuse;
- Lark Automation, Cron/Schedule or Webhook activation;
- Production action.

## Preserved parallel authority

Meta retained recovery authority remains unchanged. The only permitted Meta current-recovery entrypoint remains:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

This smoke recovery does not invoke, replace or authorize that Meta Terminal, Provider replay, D1 Queue resend,
Lark Business mutation or Production action.

## Required verification

```bash
npm ci
npm run check
node --test \
  tests/application/lark-notification-runtime-smoke-recovery.test.js \
  tests/application/lark-notification-runtime-smoke-recovery-exact-terminal.test.js \
  tests/application/lark-notification-runtime-smoke-test.test.js \
  tests/application/lark-notification-active-job-router.test.js \
  tests/connectors/d1-lark-notification-delivery-store.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Repository-only hotfix implementation is in progress. Remote actions from this branch remain zero.

The only post-merge action permitted by this task is the exact poll-only recovery Terminal:

```text
scripts/lark-notification-runtime-smoke-recovery-exact-terminal.mjs --recover
```

It contains no Queue endpoint, no HTTP POST admission, no Worker deploy and no Report Settings writer.
