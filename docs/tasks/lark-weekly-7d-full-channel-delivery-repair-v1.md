# Weekly 7D Full-channel Notification Delivery Repair v1

## Incident

The approved signal-aware Full-channel Weekly 7D preview passed, then the one-shot Notification execute admitted exactly one Queue job but never produced a D1 notification delivery or Lark mirror during 90 polls.

Retained controller result:

```text
stage                         poll-sent-and-mirrored
code                          LARK_WEEKLY_7D_FULL_CHANNEL_VERIFY_TIMEOUT
Queue attempt evidence        present
Queue admission confirmed     1
D1 admission delivery rows    0
D1 delivery status            null
D1 mirror status              null
blind rerun                   forbidden
Worker deployment by attempt  0
Notification Automation       unchanged / inactive
Schedule activation           0
Production                    BLOCKED
```

The original `--execute` evidence root is immutable and must not be rerun.

## Repository finding

The earlier reviewed Weekly Notification admission operator refreshed the exact current-main Notification Runtime before Queue admission because the retained Worker could predate the required Notification renderer/runtime flags. The later Full-channel operator reused the existing runtime but omitted that refresh and reported `workerDeploymentCount=0`.

The Worker route fails `lark.notification.send` permanently when the Notification runtime/send gate or trigger mode is not active. Main Queue permanent failures are persisted to `dead_letter_jobs` and then ACKed, so an admitted Queue message can disappear without ever creating `lark_notification_deliveries`.

This is the leading repository explanation. The exact live root cause is accepted only when the retained D1 terminal row for this exact `aiRunKey` proves one reviewed runtime/deployment rejection code.

## Correction

Add a guarded Safe Full-channel terminal rather than weakening the existing poll-only recovery contract.

### Fresh send prevention

Fresh Full-channel sends use:

```text
read-only Full-channel preview
→ generate active Notification Runtime config while preserving trigger/schedule config
→ Wrangler dry-run
→ deploy exact current main
→ verify exact version at 100% traffic
→ re-run read-only preview and require identity/message stability
→ delegate to the existing one-shot Full-channel execute
```

The existing Base Notification Automation remains inactive and no automatic Notification producer or Schedule is activated.

### Exact retained delivery repair

The incident repair must:

1. re-run the Full-channel preview read-only and bind the same factual/synthesis/Notification identity;
2. require the original persistent `03-queue-send.attempt.json` and no repair replay evidence;
3. require zero D1 delivery rows for the exact retained `aiRunKey`;
4. read recent `lark.notification.send` dead letters and select exactly one whose replay payload matches the retained `aiRunKey`, stable `operationId` and immutable job SHA-256;
5. accept only a reviewed runtime/deployment rejection (`LARK_NOTIFICATION_RUNTIME_DISABLED`, `LARK_NOTIFICATION_TRIGGER_FORBIDDEN`, `LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID`, or `UNSUPPORTED_SYNC_JOB`); any other error stops before deployment or Queue mutation;
6. require one exact open System Alert for an open terminal row;
7. validate the current Lark AI Run → Reports → active Settings → reviewed destination chain and require the rendered message SHA-256 to equal the retained pre-send preview;
8. dry-run and deploy exact current main with active Notification Runtime while preserving Worker trigger/schedule configuration, then require D1 and Full-channel preview state to remain unchanged;
9. move only the exact dead letter to `redrive_pending`, persist immutable repair replay evidence, and replay its retained payload exactly once;
10. require one D1 `sent/mirrored` delivery, one new Lark Notification Log row, `sent_to_group=true`, duplicate delivery rows `0`, and zero additional sends during a bounded observation;
11. only after successful delivery, mark the exact dead letter `redriven` and resolve its exact System Alert.

No new AI synthesis, Notification identity, Report materialization, Provider request or generic DLQ redrive is allowed.

## Repair recovery

After `04-runtime-repair-queue-replay.attempt.json` exists, blind replay is forbidden. A separate `--repair-recover` path is poll-only: it may verify an already-created delivery and close exact retained incident metadata, but cannot deploy or Queue replay.

## Parallel workstream boundary

This hotfix begins from current `main` after PR #573. It does not revert or modify the Multichannel Report/Schedule catalog and scheduler closure. The generated active Notification config preserves existing Worker trigger configuration and does not activate Daily/Weekly Report schedules.

`docs/current-task.md` remains owned by the Multichannel Report & Schedule closure workstream; this incident is recorded here to avoid overwriting that parallel authority.

## Safety

```text
Original Notification execute rerun      forbidden
Original AI synthesis retrigger           forbidden
Fresh Notification identity in repair     0
Repair Queue replay maximum               1 exact retained payload
Generic DLQ redrive                       0
Report Settings writes                    0
Base Notification Automation activation   0
Automatic Notification producer           0
Schedule activation                       0
Production                                BLOCKED
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-weekly-7d-full-channel-delivery-repair.test.js
node --test tests/scripts/lark-weekly-7d-full-channel-notification-safe-terminal-source.test.mjs
node --test tests/application/lark-weekly-7d-full-channel-notification.test.js
node --test tests/application/lark-weekly-7d-notification-admission.test.js
node --test tests/application/lark-notification-active-job-router.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

Repository implementation itself performs no Remote deployment, Queue/DLQ mutation, Lark write, D1 write, Schedule activation or Production action. Live repair remains separately confirmation-gated after merge.
