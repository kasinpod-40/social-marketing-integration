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

PR #440 corrected Select-filter identity by resolving accepted stable option names to exact current live option IDs before View PATCH.

The second resume preserved all prior mutations and completed the remaining write envelope:

```text
Field create/update     0 / 0
View create/update      4 / 5
Total schema writes         9
Record read/write       0 / 0
```

Final read-back stopped at `⚠️ Missing / Partial Data`. PR #441 added semantic comparison for one-condition conjunction and value ordering. PR #442 then added sanitized hard-read-only diagnostics.

## Proven Live root cause

The PR #442 diagnostic ran on clean exact:

```text
main@17ef82692405eec9f25b07b4cf9e0afc8c5a06e2
```

It performed nine metadata reads and zero writes. The sanitized read-back proved:

```text
View                     ⚠️ Missing / Partial Data
Field                    readiness_status
Field type               SingleSelect / 3
Operator                 is
Actual conditions        1
Actual total values      1
Expected conditions      1
Expected total values    6
Field/type/operator      exact match
Value membership         mismatch
```

Lark retained only one option ID from a six-value `SingleSelect is` condition. The defect is therefore the mutation representation, not option identity, conjunction presentation or value ordering.

## Correct representation

The stable business contract remains:

```text
readiness_status in {
  report_partial,
  report_missing,
  configuration_missing,
  source_unavailable,
  not_observed,
  validation_failed
}
```

The Lark View mutation must encode this as:

```text
conjunction = or
condition 1 = readiness_status is [option A]
condition 2 = readiness_status is [option B]
condition 3 = readiness_status is [option C]
condition 4 = readiness_status is [option D]
condition 5 = readiness_status is [option E]
condition 6 = readiness_status is [option F]
```

Each condition contains exactly one live option ID. Stable option names remain the repository contract and are resolved against current Field metadata immediately before mutation.

## Recovery rule

Preserve every successful Field, option and View mutation. The next reviewed Apply may configure only the exact collapsed predecessor:

- one existing condition;
- same accepted Field;
- SingleSelect type;
- `is` operator;
- exactly one value;
- that value is a member of the six accepted option IDs;
- expected target is six unique one-value conditions joined by `or`.

Any wrong Field, type, operator, outside value, duplicate expected value, different grouping or unrelated non-empty filter remains a hard conflict.

Expected next write envelope:

```text
Field create/update      0 / 0
View create              0
View update              1 maximum
Record read/write        0 / 0
```

Final success requires planner `zero_drift`, all six required Views, exact filter parity and zero remaining logical actions.

## Safety

```text
Record read/write                  0 / 0
Table create/rename/delete         0
Field create/update/delete         0 / 0 / 0
Select option removal              0
View create/delete                 0 / 0
View update                        1 maximum
AI/Automation/Notification         0
D1/Queue/Worker/Provider           0
Production                         BLOCKED
```
