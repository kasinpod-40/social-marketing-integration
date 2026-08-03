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

PR #440 corrected the confirmed Select-filter translation defect by resolving accepted stable option names to exact current live option IDs before View PATCH.

## Second resume result

The option-ID recovery ran on clean exact:

```text
main@cd92d61997aff9fac2ad44309c8e7cb74ce5ad73
```

It preserved all prior mutations and completed the exact remaining write envelope:

```text
Field create/update     0 / 0
View create/update      4 / 5
Total schema writes         9
Record read/write       0 / 0
```

All nine remaining accepted View requests returned success. Final read-back then stopped with:

```text
LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT
⚠️ Missing / Partial Data
```

## Current root cause

The remaining defect is comparator-only, not a failed schema mutation.

`⚠️ Missing / Partial Data` has one logical `any_of` condition containing multiple accepted Select option IDs. For one condition, `and` and `or` are semantically equivalent, and option IDs inside one `is` condition are unordered. Lark may canonicalize either presentation during read-back.

The prior comparator required exact conjunction text and exact value-array order, producing a false conflict after all remaining writes completed.

## Recovery rule

Preserve all successful additive mutations. Never delete or recreate the 23 Fields, remove the two option extensions, roll back Views or rewrite accepted filters merely to match presentation order.

Comparison must:

- canonicalize zero/one-condition conjunction to `and`;
- sort values inside each condition;
- retain strict Field ID, Field type, operator and exact value membership checks;
- retain strict conjunction checks for two or more conditions.

The next post-merge exact-main run is expected to be metadata-read-only and return `already_zero_drift` with zero Remote writes. Live preflight remains authoritative and real semantic drift must still fail closed.

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

Success still requires final planner `zero_drift` and exact semantic filter parity for all six required Views.
