# Lark Dashboard Field-Identity Recovery v3.1

## Incidents

### Unsupported Slicer mutation

The Dashboard canonical-rebind attempt failed on the first `slicer` Block with Lark HTTP 200 and business `code=1`.
Readback confirmed:

```text
confirmedBlockMutations = 0
currentBlockMayHaveWritten = false
```

No Dashboard Block, Report record or Legacy field changed in that attempt.

### Stale canonical Field IDs in v3 preview

The first read-only Field-Identity v3 preview stopped at `read-live-state` before any mutation because the
reviewed contract contained stale IDs for three canonical fields:

```text
stale metric_key ID             flduyym9cs
stale display_name ID           fldvLDwEHo
stale Number window_days ID     fldczhcM6r
```

The identity audit is grounded in the exported Integration Workspace Base schema revision `140` and exact
Report Metric table `tbl7rJypEU2ryAcr`, not in a separately generated schema snapshot.

The audited Integration Workspace Base uses:

```text
metric_key                      fldGvd3tw8 / Text
display_name                    fldE4Nezjd / Text
Number window_days              fldbPCldTL / Number
preserved slicer window         fldMlTUP3Z / SingleSelect
window Select v2                fldraj0QP8 / SingleSelect
display Select v1               fldZB452Z2 / SingleSelect
display Select v2               fldHNUhCfl / SingleSelect
```

The failed preview confirmed:

```text
confirmedBlockMutations = 0
confirmedRecordUpdates  = 0
confirmedFieldMutations = 0
```

v3.1 changes only the audited identity contract and adds regression coverage that rejects the three stale IDs.
The recovery sequence and safety boundary remain unchanged.

## Confirmed API boundary

Dashboard Slicer blocks are not part of the reviewed Block update contract. The recovery must not issue a PATCH to any Slicer.

The existing Slicers and four window charts reference the retained SingleSelect Field identity:

```text
field_id = fldMlTUP3Z
name     = __mkt_legacy_window_days_single_select_v1
type     = SingleSelect
options  = 1 / 3 / 7 / 30
```

Lark Dashboard bindings follow the Field identity. Therefore the recovery promotes this same Field ID to the sole canonical `window_days` field instead of remapping Slicers.

## Target schema

`📊 MKT_Report_Metric_Values` must retain only one field for each concept:

```text
metric_key    Text
display_name  Text
window_days   SingleSelect: 1 / 3 / 7 / 30
```

The 24 baseline-incomplete metric records remain present with `current_value=null` and render as N/A. No Report record is deleted.

## Recovery sequence

1. Read exact Dashboard, Block, Field and Record state.
2. Fail closed unless the reviewed six Dashboards, 17 Organic Statistics, five Slicers, four window charts and exact Field IDs are present.
3. Back up Report field values privately.
4. Rebind only the 17 Organic `statistics` blocks from Legacy display labels to stable `metric_key` filters.
5. Never PATCH a Slicer; `slicerPatchCount` must remain zero.
6. Backfill missing values in `fldMlTUP3Z` from the authoritative Number `window_days`, accepting only 1/3/7/30 and exact agreement with any retained v2 value.
7. Rename the Number Field `fldbPCldTL` to `__mkt_retired_window_days_number_v3` while preserving its values.
8. Rename `fldMlTUP3Z` to canonical `window_days` without changing its ID, type, options or values.
9. Re-read all Dashboard Blocks and verify zero Legacy-name references plus canonical Organic metric bindings.
10. Verify Organic computed-data protocol and all current-total numeric KPIs.
11. Delete display Legacy v1/v2, window Legacy v2 and the retired Number field.
12. Verify final record count, schema, Dashboard IDs, Block IDs and layout.

## Writer contract

Future materialization writes use:

```text
MKT_Report_Metric_Values.window_days = "1" | "3" | "7" | "30" | null
```

Only the Metric table uses the Dashboard SingleSelect representation. Snapshot, Top Content and Top Ads continue using numeric `window_days` because they have no inherited Slicer identity.

Unsupported rolling windows fail before Lark write. Custom ranges keep `window_days=null`.

## Scope contract

```text
base:dashboard:read
base:block:read
base:block:update
base:field:read
base:field:update
base:field:delete
base:record:retrieve
base:record:update
```

## Safety invariants

```text
contractVersion               = lark_dashboard_field_identity_recovery_v3_1
slicerPatchCount              = 0
recordDeleteCount             = 0
businessFactDeleteCount       = 0
layoutMutationCount           = 0
dashboardIdsPreserved         = true
blockIdsPreserved             = true
remainingLegacyFieldCount     = 0
remainingLegacyReferenceCount = 0
```

Every Statistics PATCH, Record batch and Field mutation is read back before continuation. Legacy fields are deleted only after Dashboard and computed-data verification pass.

## Repository boundary

This workstream does not edit `docs/current-task.md`, which remains owned by the Meta History workstream. Implementation and CI perform no Remote Lark/D1 mutation, Worker deployment, Queue send, Provider request, Schedule activation, Secret change or Production action.

## v3.2 continuation

The v3.1 preview discovered seven window charts: four already bound to the preserved Select and three Executive
columns bound to the retiring Number field. The field-identity recovery now continues under
`docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md`; no Slicer PATCH is introduced.
