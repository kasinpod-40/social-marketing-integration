# Lark Weekly 7D Full-channel Notification Live Closeout — 2026-08-09

## Final live result

The retained Full-channel Weekly 7D Notification incident is closed successfully on exact current `main`:

```text
main                               27aec59cddab5c560591832c4f85d7fe6b78d7b5
safe terminal contract             lark_weekly_7d_full_channel_notification_safe_terminal_v1
action                             repair
status                             weekly_7d_full_channel_notification_exact_delivery_repaired
original failure                   LARK_NOTIFICATION_RUNTIME_DISABLED
Worker deployment                  1
repair Queue replay                1 exact retained payload
new Queue admission identity       0
new Notification identity          0
message send                       1
delivery status                    sent
mirror status                      mirrored
sent_to_group                      true
exact delivery rows                1
duplicate delivery rows            0
additional sends during observe    0
retained dead letter               redriven
retained open alert                0
automatic Notification producer    false
Base Notification Automation write 0
Schedule activation                0
Production                         BLOCKED
```

## Confirmed root cause

The exact retained D1 terminal evidence proved the original one-shot Queue job failed because the active Worker Notification runtime was disabled:

```text
LARK_NOTIFICATION_RUNTIME_DISABLED
```

This closes the prior hypothesis. The source AI synthesis, factual report, destination authority and approved message were not the failure point.

The failed Full-channel operator had admitted one Queue job while reporting `workerDeploymentCount=0`. Because the Notification consumer rejects a disabled runtime permanently, the Main Queue persisted the terminal incident and ACKed the original delivery before any `lark_notification_deliveries` row could be created.

## Repair performed

The merged Safe Terminal from PR #574 performed one incident-bound repair only:

1. rebound the exact retained Full-channel Notification identity and original Queue-attempt evidence;
2. matched the exact retained dead letter and stable operation payload;
3. accepted the exact terminal code `LARK_NOTIFICATION_RUNTIME_DISABLED`;
4. refreshed the Notification Runtime from exact current main;
5. replayed the retained payload exactly once;
6. verified one D1 `sent/mirrored` delivery and Lark mirror parity;
7. verified `sent_to_group=true`, zero duplicate delivery rows and zero additional sends during observation;
8. marked only the exact retained dead letter `redriven` and closed its exact alert.

No replacement AI synthesis, Notification identity, Report materialization or generic DLQ redrive was created.

## Locked operating rule after closeout

Future reviewed Full-channel one-shot sends must use the Safe Terminal path that refreshes and verifies the active Notification Runtime before Queue admission. Do not call the legacy Full-channel `--execute` directly for a fresh send.

For this exact completed identity:

```text
rerun original --execute     FORBIDDEN
rerun --repair               FORBIDDEN
retrigger AI synthesis       FORBIDDEN
replacement Notification ID  FORBIDDEN
```

The retained repair evidence is terminal truth and must remain immutable.

## Current safety boundary

The successful one-shot delivery does **not** authorize automatic notification scheduling.

```text
Base Notification Automation    remains inactive
Automatic Notification producer false
Schedule activation             0
Production                      BLOCKED
```

Automatic Weekly Notification admission remains a separate future approval/cutover decision.
