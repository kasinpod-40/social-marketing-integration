# Report Metric Value Field Migration

## Current decision

`📊 MKT_Report_Metric_Values` remains under a Dashboard Compatibility Freeze. The physical Field identities
already used by the six Lark Dashboards are preserved; this Repository no longer attempts Dashboard Block
PATCH, Field-identity promotion or Legacy-field deletion.

```text
metric_key                       fldGvd3tw8 / Text
display_name                     fldE4Nezjd / Text
Number window_days               fldbPCldTL / Number
preserved window Select          fldMlTUP3Z / SingleSelect
window Select v2                 fldraj0QP8 / SingleSelect
display Select v1                fldZB452Z2 / SingleSelect
display Select v2                fldHNUhCfl / SingleSelect
```

Snapshot, Top Content and Top Ads tables continue to use their existing numeric `window_days`; their schemas
are independent from the Report Metric Dashboard bindings.

The 24 period-metric rows whose baseline is incomplete remain present with `current_value=null`. They are
valid N/A Business facts and are not deleted. All 86 Report Metric records are preserved.

## Historical migration ownership

The earlier value-preserving migration and Dashboard Field-Identity Recovery v3.x remain historical evidence.
Their planners may still be tested for deterministic behavior, but their public Dashboard/Field mutation
entrypoints are retired.

The former transition intended to:

```text
Number window source             fldbPCldTL
preserved slicer Select          fldMlTUP3Z
window Select v2                 fldraj0QP8
```

backfill the preserved Select, retire the Number field, promote `fldMlTUP3Z` to canonical `window_days`, then
remove retained Legacy fields. Field promotion and Legacy cleanup are superseded because Dashboard
Block/filter PATCH has no supported public Lark OpenAPI write contract in the verified operating boundary.

The lossless missing-cell portion is retained separately as a Record-only operation: Number remains
canonical for compatibility planning, and only an empty preserved Select cell may be populated with the same
`1/3/7/30` value.

## Audited Integration Workspace identities

```text
metric_key                       fldGvd3tw8 / Text
display_name                     fldE4Nezjd / Text
Number window_days               fldbPCldTL / Number
preserved window Select          fldMlTUP3Z / SingleSelect
window Select v2                 fldraj0QP8 / SingleSelect
display Select v1                fldZB452Z2 / SingleSelect
display Select v2                fldHNUhCfl / SingleSelect
```

The initial v3 preview used stale IDs `flduyym9cs`, `fldvLDwEHo` and `fldczhcM6r`; it stopped read-only before
any mutation. Recovery v3.1 corrected those IDs. v3.2 and the bounded v3.3 probe both stopped on the first
Statistics PATCH with immediate unchanged readback and zero confirmed mutation.

## Compatibility Freeze behavior

- Public v3 Terminal and Operator entrypoints are fail-closed tombstones.
- `--execute` and `--statistics-probe-only` are rejected before `.dev.vars` or Lark client access.
- Dashboard Statistics, Column and Slicer PATCH are unavailable.
- Field rename/delete and Record create/delete are unavailable.
- All Dashboard IDs, Block IDs, layouts and existing physical Field identities are preserved.
- All 86 Report records remain present.
- The 24 baseline-incomplete `current_value=null` rows remain N/A.
- No manual Dashboard UI repair is required or authorized.

## Record-only compatibility behavior

The reviewed live plan contains at most 28 records whose Number `window_days` is valid while the preserved
slicer-bound Select is empty. `scripts/lark-dashboard-compatibility-record-backfill.mjs` owns only that gap.
It uses the existing Public Bitable Record batch-update path and may write only
`__mkt_legacy_window_days_single_select_v1` on existing rows.

Before execution it requires:

```text
record count                         86
baseline-incomplete null count       24
window conflicts                      0
pending updates                      <= 28
all seven Field IDs/names/types      exact
```

It writes a private backup, performs no Dashboard/View/Field/schema operation, then reads all records again and
requires pending updates/conflicts to reach zero while preserving the 86/24 boundaries. Already-populated rows
make reruns idempotent.

## Safety state

Implementation and verification perform no Live Lark/D1/Queue/Worker/Provider/Schedule/Production action.
Public commands are:

```bash
node scripts/lark-dashboard-compatibility-freeze-audit.mjs
node scripts/lark-dashboard-compatibility-record-backfill.mjs
```

The second command is read-only unless exact Record-backfill confirmation and `--execute` are supplied after
merge and reviewed preview.

Detailed current contract:

```text
docs/tasks/lark-dashboard-compatibility-freeze-v1.md
```

## Historical v3.2 seven-window-chart correction

The exported Integration Workspace Base revision 140 contains seven window charts, not four. Four
Commerce/Chatwoot columns and all five Slicers bind the preserved Select identity `fldMlTUP3Z`. Three
Executive columns (`Net Sales by Window`, `Ad Spend by Window`, `Organic Views by Window`) bind Number
`fldbPCldTL`. v3.2 attempted to PATCH those three columns before Number retirement; the PATCH mutation path is
now retired and both physical identities remain preserved.

Historical contract:

`docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md`.

## Historical v3.3 Statistics request-contract recovery

The first v3.2 Live Statistics PATCH (`Baseline Coverage Rate`) was rejected with Lark `code=1`; immediate
readback was unchanged and all confirmed Block, Record and Field mutation counters remained zero. v3.3 then
serialized the Organic `filter` into request shape only, removed response metadata and retained the reviewed
Dashboard/Block scope union. Its bounded one-Block probe received the same rejection with unchanged readback
and zero confirmed mutation.

The repeated result disproved the expectation that request metadata or scope declaration alone would provide
a supported Dashboard write path. No further Live Dashboard PATCH attempts are allowed.

Historical contract:

`docs/tasks/lark-dashboard-statistics-request-contract-v3-3.md`.
