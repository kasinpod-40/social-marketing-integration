# Lark Weekly 7D Full-channel Notification Live Closeout — 2026-08-09

## Status

The one-shot Full-channel Weekly 7D Notification flow is closed as Live Delivery PASS with one post-delivery rendering defect identified and corrected in the repository.

```text
Live delivery identity            completed / terminal
AI synthesis identity             retained / no rerun
Notification identity             retained / no replacement
Queue admission                   1 original + 1 exact retained repair replay
Message send                      1
D1 delivery                       sent
Lark mirror                       mirrored
sent_to_group                     true
exact delivery rows               1
duplicate delivery rows           0
additional sends in observation   0
retained dead letter              redriven
retained alert open count         0
Base Notification Automation      inactive
automatic Notification producer   false
Schedule activation               0
Production                        BLOCKED
```

## Runtime incident and exact repair

The first controlled Queue admission produced no delivery row or Lark mirror because the active Worker rejected the retained job with:

```text
LARK_NOTIFICATION_RUNTIME_DISABLED
```

The corrected Safe terminal on `main@27aec59cddab5c560591832c4f85d7fe6b78d7b5` refreshed the Notification Runtime, replayed the exact retained payload once, preserved the original Notification identity, and verified:

```text
workerDeploymentCount                    1
repairQueueReplayCount                   1
queueAdmissionCountNewIdentity           0
newNotificationIdentityCount             0
messageSendCount                         1
deliveryStatus                           sent
mirrorStatus                             mirrored
sentToGroup                              true
exactDeliveryRows                        1
duplicateDeliveryRows                    0
additionalMessageSendCountDuringObservation 0
retainedDeadLetterStatus                 redriven
retainedAlertOpenCount                   0
```

The completed identity must never rerun the original `--execute` or `--repair` path.

## Post-delivery date rendering defect

The message delivered to the group showed:

```text
ช่วง 2026-07-24 ถึง 2026-07-30
```

The approved Shared Report / AI authority and read-only preview were:

```text
ช่วง 2026-07-25 ถึง 2026-07-31
```

Business metrics and AI content in the delivered message were otherwise the accepted Full-channel values. The date drift was isolated to the Notification delivery source boundary.

Root cause:

```text
numeric Lark Date epoch
→ new Date(epoch)
→ toISOString().slice(0, 10)
→ UTC calendar date
```

Lark Date epochs represent the Integration Workspace business date at Asia/Bangkok midnight. UTC conversion therefore moved the visible date one day backward.

Example:

```text
Business date            2026-07-25 00:00 Asia/Bangkok
Epoch                     1784912400000
UTC instant               2026-07-24 17:00Z
Old Notification date     2026-07-24
Correct business date     2026-07-25
```

## Repository correction

PR #576 merged as:

```text
943c0a9f1e01dd13fe7d2b6437d78f69265edc22
fix: preserve Bangkok dates in weekly notification delivery
```

`lark-notification-delivery-source.js` now converts numeric Lark Date values to `YYYY-MM-DD` in `Asia/Bangkok` using `Intl.DateTimeFormat(...).formatToParts()`. Explicit date-only strings remain unchanged.

The regression suite includes Bangkok-midnight epochs that would have produced the previous UTC date under the old implementation. Branch Verification #2369 passed all repository gates before merge.

The active Worker at this closeout remains the reviewed repair deployment from the successful one-shot flow. No additional Worker deployment is performed solely for this repository-only date correction because the automatic Notification producer and Schedule remain disabled. Every future approved Full-channel send must use the Safe Terminal, which refreshes exact current main before Queue admission; bypassing that pre-send runtime refresh is not allowed.

## Historical delivery rule

The already-sent group message is retained as historical delivery evidence and is not resent, edited, replaced, or assigned a new Notification identity solely to correct its date header.

The associated completed delivery remains terminal and deduplicated. Future Notification deliveries must first refresh current main through the Safe Terminal and then use the corrected Bangkok date normalization from `main@943c0a9f1e01dd13fe7d2b6437d78f69265edc22` or later.

## Safety state

```text
Original Notification execute rerun       forbidden
Exact delivery repair rerun                forbidden
AI synthesis retrigger                     forbidden
Replacement Notification identity          forbidden
Historical message resend                  forbidden
Automatic Notification producer            false
Base Notification Automation activation    0
Schedule activation                        0
Production                                 BLOCKED
```

## Next gate

Automatic Weekly Notification admission remains a separate approval gate. This closeout does not authorize activating the Base Notification Automation, an automatic Notification producer, Schedule/Cron, or Production.
