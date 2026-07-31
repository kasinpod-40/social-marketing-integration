# Lark Dashboard Window-Chart Rebind Recovery v3.2

## Incident

The read-only Field-Identity v3.1 preview stopped at `read-live-state` with:

```text
organicMetricBlockCount       = 17
preservedSlicerCount          = 5
preservedWindowChartCount     = 7
confirmedBlockMutations       = 0
confirmedRecordUpdates        = 0
confirmedFieldMutations       = 0
```

The v3.1 contract expected four window charts because the original legacy-reference audit counted only charts
bound to the retained Select field. The exported Integration Workspace Base revision `140` shows seven window
charts in total.

## Audited window-chart inventory

Already bound to preserved Select `fldMlTUP3Z`:

```text
Commerce & Conversion       Orders by Window
Commerce & Conversion       Gross Sales by Window
Customer Service & Leads    Resolved Conversations by Window
Customer Service & Leads    New Conversations by Window
```

Bound to canonical Number `fldbPCldTL` and requiring rebind before that Number field can be retired:

```text
Executive Marketing Overview  Net Sales by Window
Executive Marketing Overview  Ad Spend by Window
Executive Marketing Overview  Organic Views by Window
```

All five Slicers remain bound to `fldMlTUP3Z` and must never be PATCHed.

## Recovery sequence

1. Read the exact six Dashboards and current Report Metric field identities.
2. Require the exact `17 Statistics / 5 Slicers / 7 window charts` inventory.
3. Classify exactly three Executive `column` charts as Number-bound and four `column` charts as already
   preserved.
4. Preview reports the three pending chart actions with `remoteMutationCount=0`.
5. During confirmed execution, re-read each pending chart and build a delta that replaces Number
   `window_days`/`fldbPCldTL` with preserved Select
   `__mkt_legacy_window_days_single_select_v1`/`fldMlTUP3Z`.
6. Update any reviewed field-type metadata from Number `2` to SingleSelect `3` and preserve preset semantics as
   strings `"1"`, `"3"`, `"7"`, `"30"`.
7. PATCH only Block type `column`, once per chart, with immediate readback and checksum classification.
8. Stop before Record/Field mutation unless all three charts converge and the fresh plan becomes
   `17 / 5 / 7` with zero pending Number-window chart actions.
9. Continue the existing v3 Field-Identity recovery: rebind 17 Organic Statistics, backfill the preserved
   Select, retire Number, promote `fldMlTUP3Z` to canonical `window_days`, verify computed data and delete only
   reviewed retired fields.
10. Verify all seven window charts and all five Slicers remain bound through the preserved physical Field ID.

## Safety invariants

```text
contractVersion                    = lark_dashboard_field_identity_recovery_v3_2
reviewedNumberWindowChartCount     = 3
preservedWindowChartCount          = 7
preservedSlicerCount               = 5
slicerPatchCount                   = 0
layoutMutationCount                = 0
recordDeleteCount                  = 0
businessFactDeleteCount            = 0
baselineIncompleteRowsDeleted      = 0
```

A rejected or ambiguous chart PATCH is read back and fails closed. No field rename, Record backfill or field
delete may begin while a Number-bound Executive window chart remains.

## Repository boundary

`docs/current-task.md` remains owned by the Meta History workstream and is not edited. Repository implementation
and verification perform no Remote Lark/D1 mutation, Worker deployment, Queue send, Provider request,
Schedule/Secret change or Production action.
