# Customer Base View Order Closeout

## Scope

This lane closes only the per-View field/column order parity for the customer-owned Lark Base.

- Target Base: `✨Marketing Content Calendar`
- Clone scope: 32 tables / 110 cloned grid views
- Protected table: `🎵 RAW_TikTok_Creator_Videos` remains zero-write and out of this lane
- Column width is explicitly out of scope
- Record values, field schema, formulas, relations, filters, hidden fields, sort, group, row height, dashboards, automations, D1, Queue, Worker and schedules are not to be changed in this lane

## Current finding

The latest target export shows that 105 of 110 cloned grid views have a UI field order that differs from Source authority. Five views are already exact; those five are the `🔄 MKT_Sync_Log` views and must not be touched.

This is a presentation-order defect only. Record values remain attached to the correct field IDs and must not be rewritten or moved between fields.

## Root cause

The migration treated canonical table schema order and per-View display order as equivalent. They are not equivalent. Lark's documented Grid View JS SDK can read field metadata in UI order via `getFieldMetaList()`, but it does not document a setter that reorders fields/columns inside an existing Grid View. Therefore, a migration cannot claim full View parity merely because schema, filters, hidden state, sort and group are correct.

## Closeout rule

A cloned grid view is accepted only when its displayed field order equals Source authority exactly, excluding column width.

For every view:

1. Read Target UI field order.
2. Compare against Source authority field order.
3. If exact, do nothing.
4. If different, change field order only through a documented/safe mechanism. If no documented write mechanism exists, leave it for explicit manual UI closeout.
5. Preserve visibility, filter, sort, group, row height and all record/schema state.
6. Re-export Target and run a read-only parity comparison before closing the lane.

## Migration prevention rule

Future customer Base migrations must not classify field order as cosmetic-only. Before a migration is allowed to close:

- Source per-View field order must be captured as authority.
- Target per-View field order must be read back and compared.
- The final parity report must separately report `fieldOrderMismatchCount`.
- `fieldOrderMismatchCount > 0` must block `FULL_PARITY_PASS` unless the user explicitly excludes field order from scope.
- Width must remain separately scoped and must not be conflated with field order.

## Safe creation guidance for future migrations

When creating a new table, create fields in the order of the Source table's primary/default operational view when possible. This minimizes downstream manual reorder work for views that share the same field-order profile. Views with intentionally different Source orders still require explicit per-View verification.

## Current customer closeout

The current customer Base must not be recreated and no data migration should be rerun. Close only the existing View field-order remainder, then continue the already identified Dashboard manual remainder separately.
