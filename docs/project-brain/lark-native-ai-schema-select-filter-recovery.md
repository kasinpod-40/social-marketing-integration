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

PR #441 added semantic comparison for one-condition conjunction and unordered condition values.

## Third verification result

The post-PR #441 verification ran on clean exact:

```text
main@78c1947fa525afb38b229c39f909e661d1a32e19
```

It performed metadata reads only and stopped at the same View:

```text
metadataReadCount      9
fieldCreateCount       0
fieldUpdateCount       0
viewCreateCount        0
viewUpdateCount        0
totalWriteCount        0
code                   LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT
viewName               ⚠️ Missing / Partial Data
```

Therefore conjunction normalization and value ordering alone do not explain the Live read-back. The exact remaining mismatch is not yet proven.

## Current recovery rule

Preserve every successful additive mutation. Do not delete, recreate, rename or rewrite any Field, option or View until the exact read-back difference is observed.

The next Repository change is diagnostic-only. On a conflict it may retain only sanitized structural facts:

- conjunction;
- condition count;
- accepted Field name, never Field ID;
- Field type;
- operator;
- value count and scalar types;
- Boolean comparisons for field set, condition multiplicity, total value count, flattened value membership and condition grouping.

It must not retain Table/Field/View/option IDs or raw filter values.

## Hard read-only diagnostic authority

The next exact-main execution must set:

```text
MKT_LARK_NATIVE_AI_SCHEMA_APPLY_DIAGNOSTIC_ONLY=true
```

This mode calls the planner only and configures the network guard as read-only. Tenant token and Table/Field/View metadata reads are allowed. Every Field or View write is blocked before `fetch`, and successful completion requires both `totalWriteCount=0` and `blockedRequestCount=0`.

If pending accepted actions are discovered, the diagnostic fails closed and does not Apply them. No View repair is authorized from an unproven hypothesis.

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

Final success still requires planner `zero_drift` and exact semantic filter parity for all six required Views.
