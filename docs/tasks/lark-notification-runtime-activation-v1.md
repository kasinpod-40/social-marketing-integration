# Lark Notification Runtime Activation v1

Date: 2026-08-05

## Approval and prerequisite

The user explicitly approved the next workstream after the Controlled Executive Notification UAT closed
as `PASS`.

Verified prerequisite:

```text
repository_head                       dd9c1f33be877e77b6e76c8b537ab916dc6a0b50
controlled_uat                        PASS
retained_notification_message_count   1
additional_message_send_count         0
delivery_status                       sent
mirror_status                         mirrored
notification_log_rows                 1
ai_run_marked_sent                     true
notification_flags_after_closeout     all false
report_settings_restored              true
automation_activation_count           0
schedule_activation_count             0
production                            BLOCKED
```

The original Controlled UAT and retained Mirror Recovery commands remain permanently closed.

## Business objective

Make the reviewed Executive notification delivery consumer permanently ready in the Integration Workspace
without yet creating an automatic admission path.

This activation opens:

```text
MKT_NOTIFICATION_RUNTIME_ENABLED      true
MKT_NOTIFICATION_LARK_SEND_ENABLED    true
MKT_NOTIFICATION_LARK_MIRROR_ENABLED  true
MKT_NOTIFICATION_RUNTIME_MODE         runtime
```

It also enables `ai_enabled` and `notification_enabled` only for the exact Report Settings referenced by
the latest Executive Preview authority for all four windows:

```text
1D / 3D / 7D / 30D
```

## Explicitly not activated

```text
Notification Queue producer      absent
Queue admission                  0
Lark Automation                  0
Notification Cron/Schedule       0
Webhook/HTTP admission           0
Production                       BLOCKED
```

The existing Worker cron definitions remain byte-equivalent. The current `scheduled-jobs.js` must not
contain `LARK_NOTIFICATION_SEND`; the operator fails closed if a notification producer is introduced
before its own separate approval.

## Runtime-mode separation

The central runtime config now has three modes:

```text
disabled
controlled_uat
runtime
```

Admission is fail-closed:

```text
controlled_uat mode
  accepts trigger lark_notification_controlled_uat
  requires ai_run_key prefix notification-uat:

runtime mode
  accepts trigger lark_notification_runtime
  rejects ai_run_key prefix notification-uat:
```

This prevents a permanently active Runtime Worker from reopening the completed UAT identity class.

## Exact activation sequence

1. Require clean exact current `main`.
2. Require exact Integration Workspace environment.
3. Run focused tests and repository checks.
4. Prove `scheduled-jobs.js` has no notification producer.
5. Resolve exact Lark AI Runs, Report Snapshots, Report Settings and Notification Log tables.
6. Select exactly one latest sendable Executive Preview for each 1D/3D/7D/30D window.
7. Resolve every source Report Snapshot and exact Report Setting.
8. Require Settings enabled, AI false, notification false and one reviewed destination hash.
9. Require D1 notification schema, zero active locks and all delivery rows terminal `sent/mirrored`.
10. Require one retained Controlled UAT D1 row, one Lark Log row and AI Run marked sent.
11. Retain immutable private activation-attempt evidence before mutation.
12. Dry-run active and safe Worker configs.
13. Deploy Runtime-mode Worker at 100% traffic.
14. Enable AI/notification on exact source Settings.
15. Observe a bounded no-admission window.
16. Require D1 delivery rows, Lark Log rows and retained message count unchanged.
17. Leave Runtime active on success.

## Failure and rollback

Any activation failure after a possible mutation automatically:

1. restores exact Report Settings false;
2. deploys the all-false Safe Worker;
3. verifies both restorations;
4. reports Queue admission and additional message sends as zero.

A separately confirmed manual rollback remains available after successful activation:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NOTIFICATION_RUNTIME_ROLLBACK=RESTORE_NOTIFICATION_RUNTIME_ALL_FALSE \
node scripts/lark-notification-runtime-activation-exact-terminal.mjs --rollback
```

## Post-merge activation command

Run once only after exact-head CI, review and merge:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NOTIFICATION_RUNTIME_ACTIVATION=ACTIVATE_REVIEWED_EXECUTIVE_NOTIFICATION_RUNTIME \
node scripts/lark-notification-runtime-activation-exact-terminal.mjs --execute
```

## Acceptance

```text
runtime_enabled                       true
send_enabled                          true
mirror_enabled                        true
runtime_mode                          runtime
worker_traffic                        100%
exact_report_settings_active          true
queue_admission_count                 0
additional_delivery_rows              0
additional_message_send_count         0
retained_controlled_uat               stable
notification_producer_enabled         false
automation_activation_count           0
schedule_activation_count             0
production                            BLOCKED
rollback_available                    true
```

## Implementation safety status

Repository implementation and CI perform no Remote action. Live activation is a single post-merge exact-main
Terminal action. No new Queue framework, D1 writer, Lark repository, message client, delivery engine,
Scheduler or AI runtime is introduced.
