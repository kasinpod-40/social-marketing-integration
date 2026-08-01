# Lark Dashboard Window Option Order v1

## Objective

Correct the visible Organic Dashboard report-window selector order from `3, 7, 1, 30` to
`1, 3, 7, 30` without replacing the existing SingleSelect Field or any existing option identity.

## Audited Live boundary

```text
Table                              📊 MKT_Report_Metric_Values
Field ID                           fldMlTUP3Z
Field name                         __mkt_legacy_window_days_single_select_v1
Field type                         3 / SingleSelect
Current visible option order       3, 7, 1, 30
Required visible option order      1, 3, 7, 30
Report records                     86
```

Reviewed options:

```text
name  option ID     color
1     opt38OJLF0    2
3     optGqbHePA    0
7     optaGcj0mG    1
30    optmG5Z7M0    3
```

## Official API contract

Lark Bitable Field update uses `PUT` and is a full update. For SingleSelect update, existing options are sent
with their existing `id`; omitted options are deleted. Therefore the safe request must send all four existing
options exactly once, retaining each `id`, `name` and `color`, with only their array order changed.

## Operator

```text
scripts/lark-dashboard-window-option-order.mjs
```

Preview is the default mode. Live mutation requires both:

```text
--execute
CONFIRM_LARK_DASHBOARD_WINDOW_OPTION_ORDER=REORDER_WINDOW_OPTIONS_PRESERVE_IDS_1_3_7_30
```

The operator:

1. requires the exact Table and physical Field identity;
2. requires exactly the four reviewed options with exact IDs, names and colors;
3. accepts only the reviewed pre-apply order `3,7,1,30` or converged order `1,3,7,30`;
4. refuses execution unless the pre-apply order is exact;
5. requires a clean current `main == origin/main` checkout before mutation;
6. records a private backup and SHA-256 checksums;
7. performs exactly one `updateField()` call;
8. reads all Fields and 86 Records before and after;
9. requires the complete Record fingerprint to remain unchanged;
10. requires all non-target Fields to remain unchanged;
11. requires target Field identity, description, option ID/name/color set and all non-order content to remain
    unchanged; and
12. accepts completion only when readback order is exactly `1,3,7,30`.

## Mutation boundary

```text
Field metadata update calls       1
Field identity changes            0
Option creates                    0
Option deletes                    0
Option renames                    0
Option color changes              0
Record mutations                  0
current_value mutations           0
Dashboard Block PATCH             0
View PATCH                        0
D1 / Worker / Queue               0
Production                        BLOCKED
```

## Failure behavior

If the Field contains any extra/missing/duplicated option, a changed ID/name/color, an unexpected order, a
changed Record count or unrelated state drift, the operator stops before mutation.

If an error occurs during or after the `updateField()` request, do not blindly rerun `--execute`. Run preview
only and inspect whether the Field is still in the reviewed pre-apply state or has already converged.

## Acceptance criteria

```text
Preview current order             3,7,1,30
Preview desired order             1,3,7,30
Option ID set preserved           yes
Option name/color set preserved   yes
Live Field update                 exactly 1
Readback order                    1,3,7,30
Record fingerprint unchanged      yes
Other Field fingerprint unchanged yes
Dashboard and View mutation       0
Production                        blocked
```

`docs/current-task.md` remains owned by the active Meta continuation workstream and is not modified by this
bounded Dashboard compatibility hotfix.
