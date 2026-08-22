# Customer Base View Field-Order Closeout — 2026-08-22

This note supersedes both the earlier "field order is cosmetic" position and the later conclusion that all remaining order work had to be manual.

## Evidence before the capability correction

Latest Source-vs-Target export comparison for the 32-table clone scope reported:

- cloned grid Views: 110
- exact full exported field order: 5
- full exported field-order mismatches: 105
- affected cloned Tables: 31
- exact/no-touch set in that comparison: five `🔄 MKT_Sync_Log` Views

Target records remain bound to the correct Field IDs. The defect is presentation order, not record placement.

## Corrected documented capability

The official `larksuite/cli` Base shortcut `+view-set-visible-fields` documents:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

Official guidance states that `visible_fields` controls both **visibility and order**. The earlier manual-only conclusion checked the Grid View JS SDK but missed this documented Base v3 property.

## Root cause in this repository

The shared Lark parity client already used `visible_fields` for hidden-field parity, but its readback intentionally sorted the expected and actual arrays before comparing membership. A reversed array could therefore pass hidden-field verification because hidden membership was correct while visible order was ignored. This is why canonical/hidden parity could pass while the UI column sequence still differed.

The hidden-field behavior was correct for that gate; the mistake was treating the same transport as proof of order parity.

## Safe repair contract

Implemented in the existing documented View parity lane:

- `planLarkBaseDocumentedVisibleFieldOrderParity`
- `applyLarkBaseDocumentedVisibleFieldOrderParity`
- exact confirmation `APPLY_CUSTOMER_BASE_VISIBLE_FIELD_ORDER_V1`
- production operator `scripts/customer-base-visible-field-order-parity.mjs`

The repair:

1. pins the exact Source SHA `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`;
2. excludes protected `🎵 RAW_TikTok_Creator_Videos`;
3. verifies Target identity anchors and 32-table / 705-field / 110-view clone scope;
4. derives Source visible order from Source field order minus hidden fields;
5. requires Target visible membership to match Source before any write;
6. writes only mismatching View `visible_fields` order;
7. exact ordered GET-readback after every PUT;
8. rolls back all changed Views if any readback fails;
9. performs zero Table/Field/Record/Filter/Sort/Group/Formula/Dashboard/Automation/Worker/D1/Queue/schedule mutations.

## Acceptance semantics

Displayed field/column order is the order of visible fields. Hidden membership is a separate already-closed parity dimension. Relative positions of hidden fields inside an exported full `fieldOrder` array are not displayed-column order and are not writable through the documented `visible_fields` contract.

The final export verifier therefore compares visible-field order while keeping width excluded. Hidden membership remains owned by its already-passed gate.

## Remaining sequence

1. Focused tests/syntax on the exact branch HEAD.
2. Target read-only preview through `scripts/customer-base-visible-field-order-parity.mjs`.
3. One confirmed order-only apply if preview is clean.
4. Exact live readback must end with 110/110 Views exact.
5. Fresh Target `.base` export and local read-only View parity verification.
6. Close Dashboard remainder: 7 slicers + 2 table_view widgets + `summerBreeze` presentation.
7. Final export parity within agreed scope, then Ready/Merge only on explicit user instruction.
