# Report Metric Value Field Migration

## Current decision

`📊 MKT_Report_Metric_Values` uses one canonical field per concept:

```text
metric_key    Text
display_name  Text
window_days   SingleSelect: 1 / 3 / 7 / 30
```

The Metric table keeps `window_days` as SingleSelect because the existing Dashboard Slicers are bound to the
physical Field identity `fldMlTUP3Z`. Snapshot, Top Content and Top Ads tables continue to use numeric
`window_days`; their schemas are independent and have no inherited Slicer binding.

The 24 period-metric rows whose baseline is incomplete remain present with `current_value=null`. They are
valid N/A Business facts and are not deleted.

## Historical migration ownership

The earlier value-preserving migration remains responsible for `display_name` SingleSelect → Text recovery.
For current Schema v4, `window_days` is a read-only ownership assertion in that migration and must not be
converted back to Number.

Dashboard Field-Identity Recovery owns the Metric-table window transition:

```text
Number window source             fldbPCldTL
preserved slicer Select          fldMlTUP3Z
window Select v2                 fldraj0QP8
```

It losslessly backfills the preserved Select, retires the Number field, promotes `fldMlTUP3Z` to canonical
`window_days`, verifies Dashboard bindings and computed data, then removes retained Legacy fields.

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
any mutation. Recovery contract v3.1 replaces those IDs and contains a regression that rejects their return.

## Durable operator behavior

- Preview reads metadata, Records and Dashboard Blocks without mutation.
- Exact Field identities, six Dashboards, 17 Organic Statistics, five Slicers and seven window charts fail closed.
- Slicers are never PATCHed.
- Statistics changes, Record batches and Field changes are checkpointed and freshly read back.
- Legacy fields are deleted only after canonical Dashboard binding and computed-data verification pass.
- No Report record or Business fact is deleted.

## Safety state

Implementation and verification perform no Live Lark/D1/Queue/Worker/Provider/Schedule/Production action. Live write is
allowed only through the exact confirmed operator after reviewed-main verification and a successful read-only preview.

Detailed contract:

```text
docs/tasks/lark-dashboard-field-identity-recovery-v3.md
```

## v3.2 seven-window-chart correction

The exported Integration Workspace Base revision 140 contains seven window charts, not four. Four Commerce/Chatwoot
columns and all five Slicers already bind the preserved Select identity `fldMlTUP3Z`. Three Executive columns
(`Net Sales by Window`, `Ad Spend by Window`, `Organic Views by Window`) bind Number `fldbPCldTL` and
must be PATCHed to the preserved Select before Number retirement. Recovery v3.2 requires the exact 17/5/7 inventory,
updates only those three reviewed `column` Blocks with immediate readback, keeps `slicerPatchCount=0`, and blocks
Record/Field mutation until no Number-window chart remains. Detailed contract:

`docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md`.

## v3.3 Statistics request-contract recovery

The first v3.2 Live Statistics PATCH (`Baseline Coverage Rate`) was rejected with Lark `code=1`; immediate
readback was unchanged and all confirmed Block, Record and Field mutation counters remained zero. The failure
proved that the Update request path still required contract hardening, but the generic response did not prove
one exact root cause.

Recovery v3.3 serializes the Organic `filter` into request shape only and removes Read-response metadata such as
`condition_id`, `field_type`, `condition_omitted` and response `type`. It declares `base:dashboard:update`, emits
a private `statistics-request-plan.json`, and provides a bounded one-Block probe for `Baseline Coverage Rate`.
The probe stops before Window charts, Records or Fields and must converge on readback before full Recovery resumes.

Detailed contract:

`docs/tasks/lark-dashboard-statistics-request-contract-v3-3.md`.
