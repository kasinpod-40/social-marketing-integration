# Lark Executive Notification Controlled UAT v1

Date: 2026-08-04

## Objective

Close the first real executive-notification delivery proof with one message to the reviewed Lark group, one exact replay that cannot send again, and automatic restoration to the all-false Worker and Report Settings state.

## Confirmed live baseline

```text
Migration 0019                   applied
Notification table/indexes       1 / 3
Notification delivery rows       0
Safe Worker deployment           100 percent traffic
Notification flags               all false
Active D1 locks                  0
Base Automations active          0
Schedule activation              0
Production                       BLOCKED
```

The latest Base contains generated Executive Preview output, but Preview rows remain intentionally ineligible and immutable as Preview evidence. A Controlled UAT therefore creates one separate 1D Executive UAT identity rather than editing the retained Preview row.

## Root contract corrections

Executive AI rows own an AI report identity and reference the exact Shared Report evidence through `source_report_ids_json`. Notification delivery resolves that source Report set, requires one common customer profile and period, loads every exact source Setting, and requires every Setting to resolve to the same reviewed destination. It does not require the AI `report_id` to equal one source Snapshot `report_id`.

The legacy direct single-Report path remains supported when `source_report_ids_json` is absent.

The deployed Worker now enters through the Lark notification router and then falls through the complete existing Chatwoot-first router chain. The earlier export-only wiring did not make the notification route reachable from the default Queue handler.

## One-command UAT sequence

```text
read-only D1/Lark preflight
→ create one dedicated 1D Executive UAT AI row
→ enable only the exact source Report Settings temporarily
→ deploy notification Runtime/Send/Mirror active; all other execution flags false
→ send one existing Queue job
→ require D1 sent + mirrored, one Lark Notification Log row and AI sent marker
→ send the exact same job again
→ require D1 claim_count to increase exactly once while sent_at/message hash stay unchanged
→ deploy all notification flags false
→ restore source Report Settings false
→ exact terminal independently reads back and restores those Settings false again
```

## Safety

- exact destination: `Social MKT Executive Reports`;
- raw destination, Table IDs, Queue IDs and account IDs are not emitted in public evidence;
- D1 atomic claim remains the send authority;
- a terminal sent replay only increments the durable replay-observation counter and cannot acquire/send;
- unknown transport outcome remains `blocked_unknown` with no automatic resend;
- no existing Preview row is modified;
- no Automation is activated;
- no Schedule is activated;
- no Production cutover;
- retained Meta Work is untouched;
- blind rerun after any Queue attempt evidence is forbidden;
- the public exact terminal always verifies and restores exact source Report Settings false after the child exits.

## Execution

Plan-only default:

```bash
node scripts/lark-notification-controlled-uat-exact-terminal.mjs
```

Separately approved execution:

```bash
CONFIRM_LARK_NOTIFICATION_CONTROLLED_UAT=SEND_ONE_EXECUTIVE_NOTIFICATION_AND_VERIFY_REPLAY \
node scripts/lark-notification-controlled-uat-exact-terminal.mjs --execute
```

The exact terminal must run from clean exact current `main`. The child restores the Worker and Settings in `finally`; the exact terminal independently enforces the Settings false readback after child exit.

## Live preflight incident and correction — 2026-08-05

The first execution after the Queue-inventory hotfix stopped at `upsert-dedicated-uat-ai-run` with
`LARK_PREFLIGHT_FAILED` on `channel_status_vector_json`. The dedicated UAT builder correctly preserved
the reviewed Executive Preview evidence, but the Preview record had been read from Lark with Text cells in
Rich-text response shape. Copying that response shape directly into a new Text write payload violated the
existing serializer contract before any Record write, Worker deployment, Queue send or notification send.

The failure path verified:

```text
Safe Worker restored           true
Exact Report Settings restored true
Automation activation          0
Schedule activation            0
Notification send              0
Production                     BLOCKED
```

The correction reuses the existing `LarkRecordRepository`, `readLarkText` and standard Lark field serializer.
Only object/array values that match a recognized Lark Text readback wrapper are converted to primitive Text
before normal serialization. Arbitrary Business objects remain rejected, so this does not weaken JSON, URL,
Number, Select or Checkbox contracts and does not introduce another writer, sync engine or UAT operator.

A focused regression reproduces Rich-text values for `channel_status_vector_json` and the four Executive AI
output fields, while separately proving that an arbitrary object still fails closed. Live execution remains a
separate exact-main action after merge and passing CI. Because the evidence directory is bound to the main SHA,
the corrected run has a fresh attempt identity; it must not be run more than once.
