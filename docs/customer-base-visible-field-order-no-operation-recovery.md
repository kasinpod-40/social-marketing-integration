# Customer Base visible-field order — Lark 800070003 recovery

## Live incident

The confirmed visible-field-order apply reached four View updates, then Lark returned:

`800070003 api_error: no operation produced`

The existing transactional safety path restored all four prior View changes successfully:

- `changedViewCount = 4`
- `rollbackMutationCount = 4`
- `rollbackFailures = []`

Therefore the failed attempt did not leave a known partial View-order mutation.

## Handling rule

Do not ignore `800070003` globally.

For the documented Base v3 `PUT .../visible_fields` lane only:

1. Catch only `LARK_PERMANENT_API_ERROR` whose `details.larkCode` is exactly `800070003`.
2. Immediately GET the same View's `visible_fields`.
3. If ordered readback equals the requested list exactly, accept the response as a verified idempotent/no-op success.
4. If ordered readback still differs, fail closed with `VISIBLE_FIELD_ORDER_LARK_NO_OPERATION_NOT_APPLIED`.
5. Existing apply rollback then restores all earlier changed Views.

This accommodates stale preflight/converged state without weakening the exact ordered readback gate.

## Operator output fix

The operator's final machine-readable error now writes to stdout, while progress events remain stderr. This keeps `tee` result files valid JSON on both success and failure and avoids the earlier empty-file `JSONDecodeError` in the shell post-check.
