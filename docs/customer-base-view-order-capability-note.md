# Lark Grid View field-order capability note

This note records the corrected capability boundary for the customer Base View-order lane.

## Documented capability

The Grid View JS SDK still exposes `getFieldMetaList()` for reading UI order and does not expose an existing-View reorder setter.

However, the official `larksuite/cli` Base shortcuts document a separate Base v3 View property contract:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

The official shortcut is `base +view-set-visible-fields`. Its guidance explicitly states that `visible_fields` controls both visibility and order, and that every field which should remain visible must be included. The request body is a JSON object:

```json
{"visible_fields":["field-id-1","field-id-2"]}
```

Therefore the earlier conclusion "field order has no documented write contract and must be manual" was incomplete: it considered only the JS SDK and missed the documented Base v3 `visible_fields` property.

## Customer safety boundary

For the existing customer Base we use this documented contract only as an **order-only closeout**:

- Source hidden membership is authoritative and already passed its separate parity gate.
- Before any write, Target `visible_fields` membership must exactly match Source visible membership.
- Only the order of that same member set may change.
- Every PUT is followed by ordered GET readback.
- Any readback failure triggers rollback of every View changed in the current run.
- The protected `🎵 RAW_TikTok_Creator_Videos` table is excluded from scope.
- No Table, Field, Record, Filter, Sort, Group, Formula, Dashboard, Automation, Worker, D1, Queue or schedule mutation belongs to this lane.

## Acceptance semantics

Displayed column order means the order of **visible** fields. Relative positions of hidden fields are not a displayed-column requirement; hidden membership remains owned by the already-closed hidden-field parity gate.

`FULL_PARITY_PASS` remains blocked until all 110 cloned Views have exact visible-field order and the final Target export verifies the agreed scope.
