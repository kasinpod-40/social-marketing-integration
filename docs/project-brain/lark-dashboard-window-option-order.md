# Lark Dashboard Window Option Order

## Current identity contract

The Organic Dashboard report-window Slicer uses the preserved Integration Workspace SingleSelect Field:

```text
Table       📊 MKT_Report_Metric_Values
Field ID    fldMlTUP3Z
Field name  __mkt_legacy_window_days_single_select_v1
Type        3 / SingleSelect
```

The four option identities are Business/UI compatibility facts and must not be recreated:

```text
1   opt38OJLF0   color 2
3   optGqbHePA   color 0
7   optaGcj0mG   color 1
30  optmG5Z7M0   color 3
```

## Verified defect

The Base export shows the option array ordered as `3, 7, 1, 30`. Lark renders the Slicer choices in this
Field option order, so the visible report-window selector is not chronological.

The required order is:

```text
1, 3, 7, 30
```

## Safe correction

Lark Field update is a full `PUT`. The safe correction must submit all four existing options with the same
`id`, `name` and `color`, changing only their array order. Omitting or recreating an option is prohibited.

The guarded operator is:

```text
scripts/lark-dashboard-window-option-order.mjs
```

It fingerprints all 86 Records and every non-target Field before and after. It performs no Record, Dashboard,
View, D1, Worker, Queue or Production mutation.

Detailed contract:

```text
docs/tasks/lark-dashboard-window-option-order-v1.md
```
