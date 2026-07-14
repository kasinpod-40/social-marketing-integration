# Lark Report View PATCH Request Fix v0.9.2

> Historical note: this release tested one hypothesis against generic `1254001`. Live Apply still failed. The current contract and isolation strategy are documented in `lark-report-view-filter-only-patch-v0.9.4.md`.


> Superseded note: v0.9.2 corrected the request condition shape, but live Apply still failed because the View contract attempted to hide the Primary/Index field. See `lark-report-view-primary-field-fix-v0.9.3.md`.

## Incident

`setup:report-views:apply` failed on the first action (`📊 Client Metrics`) with Lark code `1254001 WrongRequestBody` and `appliedActionCount=0`.

## Root cause

The internal View model correctly needs field type metadata to validate Checkbox and Select filters. However, v0.9.1 serialized that metadata back into the PATCH request as numeric `field_type`.

The View PATCH request condition must be serialized as:

```json
{
  "field_id": "fld...",
  "operator": "is",
  "value": "["true"]"
}
```

`field_type` may appear in the API response and remains part of the internal normalized model, but it is not sent in the mutation request.

## Preserved behavior

- SingleSelect values resolve from contract names to live option IDs.
- Checkbox values use JSON-array strings such as `["true"]`.
- Preview remains read-only.
- Apply requires both the explicit apply script and `CONFIRM_WRITE=YES`.
- The installer never deletes Views or Report records.
- A rerun compares normalized live response metadata with the desired contract for idempotency.

## Diagnostics

If Lark rejects a future View PATCH, the error includes `details.viewMutationBody`. This is a non-secret copy of the exact outgoing body and can be shared for debugging.

## Recovery

The observed v0.9.1 failure reported `appliedActionCount=0`, so no rollback or View cleanup is required. Upgrade, run Preview, Apply, then Preview again until `actions: []`.
