# Customer Base View Field-Order Closeout — 2026-08-22

This note supersedes earlier statements that treated View field order as a non-blocking cosmetic remainder.

## Current evidence

Latest Source-vs-Target export comparison for the 32-table clone scope:

- cloned grid Views: 110
- exact field order: 5
- field-order mismatches: 105
- affected cloned Tables: 31
- exact/no-touch set: all five `🔄 MKT_Sync_Log` Views

Target records are still bound to the correct Field IDs. The defect is the displayed per-View column order, not record placement.

## Acceptance decision

- `fieldOrder` = blocking parity dimension
- `columnWidth` = excluded by explicit user decision
- Advanced Permission Roles = excluded by explicit user decision
- protected `🎵 RAW_TikTok_Creator_Videos` = zero-write / excluded

`FULL_PARITY_PASS` is forbidden while any in-scope View field order differs from Source.

## Capability boundary

Official Lark Grid View JS SDK documents reading UI order through `getFieldMetaList()` and writes for filter/sort/group/show-hide/width/row height, but no documented setter for reordering an existing View's field sequence. Do not invent an undocumented reorder payload.

## Closeout

Close mismatching orders in the Lark UI only, preserving records/schema/filters/hidden/sort/group/row-height/frozen state. Re-export Target and run `scripts/customer-base-view-export-parity.mjs` against the approved Source SHA `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`.

The Dashboard manual remainder remains independently open after View order: 7 slicers + 2 table_view widgets + `summerBreeze` presentation.
