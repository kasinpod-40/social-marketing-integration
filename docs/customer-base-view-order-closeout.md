# Customer Base View Order Closeout

## Scope

This lane closes only the displayed per-View column order for the customer-owned Lark Base.

- Target Base: `✨Marketing Content Calendar`
- Clone scope: 32 Tables / 705 Fields / 110 cloned grid Views
- Protected `🎵 RAW_TikTok_Creator_Videos`: zero-write and excluded
- Column width: out of scope by user decision
- Hidden membership: already closed separately
- Records/schema/formulas/relations/filters/sort/group/row height/frozen state/dashboards/automations/Worker/D1/Queue/schedules: no mutation in this lane

## Evidence

An earlier Source-vs-Target export comparison reported 105/110 mismatches in the full exported `fieldOrder` arrays. This is presentation state only; record values remain attached to the correct Field IDs.

## Corrected capability

The JS SDK itself has no existing-View reorder setter, but official `larksuite/cli` documents the Base v3 View property:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

Official guidance states that `visible_fields` controls both visibility and order. Therefore manual dragging is no longer the default repair.

## Root cause

The migration already used `visible_fields` for hidden-field parity. That gate compared membership after sorting arrays, which is correct for visibility but intentionally discards order. As a result, hidden parity could pass while displayed order remained different.

## Safe closeout rule

A cloned View is accepted when its **visible-field order** equals Source exactly. Hidden membership remains owned by its separate already-passed gate.

The operator must:

1. Pin the exact approved Source export.
2. Exclude the protected TikTok table.
3. Verify Target identity and exact clone scope.
4. Read all 110 Views before writing.
5. Derive Source visible order from Source `fieldOrder` minus hidden fields.
6. Refuse to write if Target visible membership differs from Source.
7. PUT only mismatching `visible_fields` arrays in Source order.
8. Exact ordered GET-readback after every write.
9. Roll back every View changed in the current run if any write/readback fails.
10. Re-export Target and run `scripts/customer-base-view-export-parity.mjs`.

Production operator:

```text
scripts/customer-base-visible-field-order-parity.mjs
```

Confirmation:

```text
APPLY_CUSTOMER_BASE_VISIBLE_FIELD_ORDER_V1
```

## Final acceptance

- all 110 cloned Views exact in visible-field order;
- hidden membership unchanged and already passed;
- width excluded;
- fresh Target export has zero in-scope View mismatches;
- then continue Dashboard manual remainder separately.
