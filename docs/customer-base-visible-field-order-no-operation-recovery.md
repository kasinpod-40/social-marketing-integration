# Customer Base visible-field order — Lark 800070003 live capability result

## Live incidents

Two confirmed visible-field-order apply attempts reached the same backend boundary.

### Attempt 1

The apply changed four Views, then Lark returned:

`800070003 api_error: no operation produced`

Transactional rollback restored all four changed Views:

- `changedViewCount = 4`
- `rollbackMutationCount = 4`
- `rollbackFailures = []`

### Attempt 2 — guarded readback

A narrow guard was added only for `PUT .../visible_fields`: when Lark returned `800070003`, the operator immediately GET-read the same View and accepted the response only if the requested ordered list was already exact.

The live Target disproved the idempotent/no-op hypothesis:

- failing View: `📐 MKT_Metric_Definitions.📋 All Metrics`
- cause: `VISIBLE_FIELD_ORDER_LARK_NO_OPERATION_NOT_APPLIED`
- Lark returned `800070003`
- immediate ordered readback still differed from the requested order
- `changedViewCount = 4`
- `rollbackMutationCount = 4`
- `rollbackFailures = []`

Therefore the second attempt also left no known partial View-order mutation.

## Corrected capability conclusion

The official `larksuite/cli` shortcut documents that Base v3 `visible_fields` controls both visibility and order. However, on this live customer Target, an order-only request whose visible membership is already identical is rejected as `no operation produced`, and ordered readback proves that the requested reorder was not applied.

The Base JS SDK documents ordered reads (`getFieldMetaList`, `getVisibleFieldIdList`) plus show/hide/width/row-height operations, but exposes no documented existing-View field-order setter.

For this customer Target, exact visible-field reorder is therefore **not proven writable through the currently documented safe automatic lanes**.

## Safety rule

Do not rerun the confirmed order-only apply. Do not weaken verification, ignore `800070003`, recreate Views, or introduce temporary visibility changes merely to force a reorder without a separately approved mutation plan.

Current status:

- Source mutation: 0
- protected TikTok mutation: 0
- Table/Field/Record mutation: 0
- failed attempt partial state: none known; both attempts rolled back completely
- visible-field order: unresolved presentation parity

The remaining paths are manual UI parity or an explicit acceptance-scope decision. Dashboard parity remains independently open.

## Operator output fix retained

The operator's final machine-readable error writes to stdout while progress events remain stderr. `tee` therefore captures valid JSON on failure and avoids the earlier empty-file `JSONDecodeError`.
