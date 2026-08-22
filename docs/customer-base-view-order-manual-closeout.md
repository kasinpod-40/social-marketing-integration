# Customer Base View field-order closeout

## Final capability decision

View field order is now **manual UI only** for this customer Target.

The official Base v3 `visible_fields` endpoint is documented to control visibility and order, but two live order-only attempts on the customer Target proved that it cannot safely close the existing order drift when visible membership is unchanged.

### Live attempt evidence

Attempt 1:

- four Views changed;
- Lark then returned `800070003 api_error: no operation produced`;
- transaction rollback restored all four Views;
- `rollbackFailures = []`.

Attempt 2:

- the operator accepted `800070003` only if immediate ordered GET readback exactly matched the requested order;
- failing View: `📐 MKT_Metric_Definitions → 📋 All Metrics`;
- immediate readback still differed;
- operator raised `VISIBLE_FIELD_ORDER_LARK_NO_OPERATION_NOT_APPLIED`;
- four earlier changed Views rolled back;
- `rollbackFailures = []`.

The Base JS SDK exposes ordered reads but no documented reorder setter for an existing Grid View.

Therefore:

- do not rerun `scripts/customer-base-visible-field-order-parity.mjs --apply`;
- do not ignore `800070003`;
- do not temporarily hide/show fields merely to try to force order;
- do not recreate Views;
- do not use undocumented View payloads.

## Manual UI procedure

For each mismatching cloned View:

1. Open the existing Target View.
2. Open `Customize Field` / the View field-order editor.
3. Reorder existing columns to the exact Source visible-field order.
4. Change **order only**.
5. Keep current visible/hidden membership unchanged.
6. Keep Filter unchanged.
7. Keep Sort unchanged.
8. Keep Group unchanged.
9. Keep Row Height unchanged.
10. Keep frozen-column state unchanged.
11. Do not resize Width; width is excluded from acceptance.
12. Do not touch `🎵 RAW_TikTok_Creator_Videos`.

Latest comparison before manual closeout found 105/110 View-order mismatches. The five `🔄 MKT_Sync_Log` Views were already exact and should be skipped unless fresh evidence proves drift.

Source field-order authority is the exact approved Source export SHA:

`9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`

and its generated manual View manifest.

## Acceptance

This lane closes only when:

- displayed visible-field order matches Source for all 110 cloned Views;
- hidden membership remains unchanged and already-passed;
- no protected-table change occurs;
- final exported Target read-only verification reports zero in-scope View-order mismatches;
- Width remains excluded by user decision.

Do not run final export verification until the Dashboard manual lane is also complete; export once after both manual lanes to avoid unnecessary repeated work.
