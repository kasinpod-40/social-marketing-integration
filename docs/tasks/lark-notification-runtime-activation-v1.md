# Lark Notification Runtime Activation v1

Date: 2026-08-05
Status: `CLOSED_PASS`

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

This activation opened:

```text
MKT_NOTIFICATION_RUNTIME_ENABLED      true
MKT_NOTIFICATION_LARK_SEND_ENABLED    true
MKT_NOTIFICATION_LARK_MIRROR_ENABLED  true
MKT_NOTIFICATION_RUNTIME_MODE         runtime
```

It also enabled `ai_enabled` and `notification_enabled` only for the exact Report Settings referenced by
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

The existing Worker cron definitions remain unchanged. The current `scheduled-jobs.js` does not contain
`LARK_NOTIFICATION_SEND`. Notification producer/admission remains behind its own separate approval.

## Runtime-mode separation

The central runtime config has three modes:

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

This prevents the active Runtime Worker from reopening the completed UAT identity class.

## Exact activation sequence completed

1. Required clean exact current `main`.
2. Required exact Integration Workspace environment.
3. Ran focused tests and repository checks.
4. Proved `scheduled-jobs.js` had no notification producer.
5. Resolved exact Lark AI Runs, Report Snapshots, Report Settings and Notification Log tables.
6. Selected exactly one latest sendable Executive Preview for each 1D/3D/7D/30D window.
7. Resolved every source Report Snapshot and exact Report Setting.
8. Required Settings enabled, AI false, notification false and one reviewed destination hash.
9. Required D1 notification schema, zero active locks and terminal `sent/mirrored` delivery state.
10. Required one retained Controlled UAT D1 row, one Lark Log row and AI Run marked sent.
11. Retained immutable private activation-attempt evidence before mutation.
12. Dry-ran active and safe Worker configs.
13. Deployed Runtime-mode Worker at 100% traffic.
14. Enabled AI/notification on exact source Settings.
15. Observed a bounded no-admission window.
16. Confirmed D1 delivery rows, Lark Log rows and retained message count unchanged.
17. Left Runtime active on success.

## Live activation evidence

```text
contract_version                       lark_notification_runtime_activation_v1
phase                                  active
repository_head                        5833c558d70efcfca08d476a30449b72d8555213
active_worker_version                  958e183e-fb0d-4795-a547-d805111ca6fc
traffic_percentage                     100
runtime_enabled                        true
send_enabled                           true
mirror_enabled                         true
runtime_mode                           runtime
activated_report_setting_count         4
delivery_rows                          1
retained_notification_message_count    1
additional_delivery_rows               0
additional_message_send_count          0
notification_log_rows                  1
controlled_uat_sent_stable             true
queue_admission_count                  0
notification_producer_enabled          false
notification_flags_active              true
report_settings_active                 true
rollback_available                     true
automation_activation_count            0
schedule_activation_count              0
production                             BLOCKED
next_gate                              notification_admission_requires_separate_approval
```

## Failure and rollback authority

The successful activation remains reversible. The separately confirmed rollback:

1. deploys the all-false Safe Worker;
2. restores the exact Report Settings false;
3. verifies both restorations;
4. sends no Queue job and preserves all retained D1/Lark delivery evidence.

Rollback command, to be used only after explicit rollback instruction:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NOTIFICATION_RUNTIME_ROLLBACK=RESTORE_NOTIFICATION_RUNTIME_ALL_FALSE \
node scripts/lark-notification-runtime-activation-exact-terminal.mjs --rollback
```

## Acceptance result

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

All acceptance conditions passed. Runtime Activation is closed. Do not rerun the activation, Controlled UAT
or Mirror Recovery commands. Notification Admission is a separate future workstream and remains unapproved.
