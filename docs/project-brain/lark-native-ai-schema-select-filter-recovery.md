# Project Brain — Lark Native AI Schema Select Filter Recovery

## Current authority

PR #438 merged the reviewed additive-only Apply authority for the existing `🧠 MKT_AI_Report_Runs` table.

The first Remote Apply retained a safe partial result:

```text
23 Fields created
2 Select Fields extended
2 Views created
1 View filter updated
28 total schema-write requests
0 Record reads/writes
0 delete/rename/type changes
```

It stopped while configuring `📊 Executive Summaries` with `LARK_PERMANENT_API_ERROR`.

## Root cause

The logical View contract stores Select conditions by stable option name. Lark View filters require the live Select option ID. Apply v1 sent names directly, while the existing Lark client and read-back contract use IDs.

## Recovery rule

Preserve all successful additive mutations. Never delete or recreate the 23 Fields, remove the two option extensions, or roll back the created Views.

The recovery implementation resolves each accepted Select option name to exactly one current live option ID before View PATCH and compares final read-back through the same ID-based representation.

Checkbox values remain JSON Booleans. Missing or ambiguous option IDs stop before the affected write.

## Safety

```text
Record read/write                  0 / 0
Table create/rename/delete         0
Field delete/type change           0
Select option removal              0
View delete                        0
AI/Automation/Notification         0
D1/Queue/Worker/Provider           0
Production                         BLOCKED
```

Success requires final planner `zero_drift` and exact filter parity for all six required Views.