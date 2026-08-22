# Customer Base View field-order closeout

## Superseded manual procedure

The earlier 105-View drag checklist is **no longer the primary closeout path**.

A later review of the official `larksuite/cli` Base shortcuts found the documented Base v3 `visible_fields` View property. Lark states that `visible_fields` controls both visibility and order. The supported write is:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

The customer Base lane now uses `scripts/customer-base-visible-field-order-parity.mjs` and the shared documented View parity implementation.

## Safe automated sequence

1. Load the exact approved Source export SHA.
2. Exclude protected `🎵 RAW_TikTok_Creator_Videos` from clone scope.
3. Verify Target identity anchors and all 32 clone Tables.
4. Read all 110 cloned Views.
5. Derive Source visible order from Source `fieldOrder` minus Source hidden fields.
6. Require Target visible membership to equal Source membership before any write.
7. PUT only mismatching `visible_fields` arrays in Source order.
8. GET-readback each changed View in exact order.
9. On any failure, restore all changed Views to their pre-run `visible_fields` arrays.
10. Re-export Target and run `scripts/customer-base-view-export-parity.mjs`.

## Manual fallback

Manual dragging is allowed only if the documented API lane fails closed for a specific proven Lark capability/readback reason. It is not the default procedure anymore.

## Acceptance

The field-order lane closes only when:

- all 110 cloned Views have exact **visible-field order**;
- hidden membership remains unchanged and already-passed;
- final exported Target has zero in-scope View parity mismatches;
- width remains excluded by user decision.
