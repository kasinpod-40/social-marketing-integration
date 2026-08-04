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

## Root contract correction

Executive AI rows own an AI report identity and reference the exact Shared Report evidence through `source_report_ids_json`. Notification delivery must resolve that source Report set, require one common customer profile and period, load every exact source Setting, and require every Setting to resolve to the same reviewed destination. It must not require the AI `report_id` to equal one source Snapshot `report_id`.

The legacy direct single-Report path remains supported when `source_report_ids_json` is absent.

## One-command UAT sequence

```text
read-only D1/Lark preflight
→ create one dedicated 1D Executive UAT AI row
→ enable only the exact source Report Settings temporarily
→ deploy notification Runtime/Send/Mirror active; all other execution flags false
→ send one existing Queue job
→ require D1 sent + mirrored, one Lark Notification Log row and AI sent marker
→ send the exact same job again
→ require D1 sent_at/message hash and Lark mirror state unchanged
→ deploy all notification flags false
→ restore source Report Settings false
```

## Safety

- exact destination: `Social MKT Executive Reports`;
- raw destination, Table IDs, Queue IDs and account IDs are not emitted in public evidence;
- D1 atomic claim remains the send authority;
- unknown transport outcome remains `blocked_unknown` with no automatic resend;
- no existing Preview row is modified;
- no Automation is activated;
- no Schedule is activated;
- no Production cutover;
- retained Meta Work is untouched;
- blind rerun after any Queue attempt evidence is forbidden.

## Execution

Plan-only default:

```bash
node scripts/lark-notification-controlled-uat.mjs
```

Separately approved execution:

```bash
CONFIRM_LARK_NOTIFICATION_CONTROLLED_UAT=SEND_ONE_EXECUTIVE_NOTIFICATION_AND_VERIFY_REPLAY \
node scripts/lark-notification-controlled-uat.mjs --execute
```

The operator must run from clean exact current `main` and restores safe state in `finally`.
