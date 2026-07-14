# Lark Report View Filter Fix — v0.9.1

> Historical note: this release tested one hypothesis against generic `1254001`. Live Apply still failed. The current contract and isolation strategy are documented in `lark-report-view-filter-only-patch-v0.9.4.md`.


## Incident

The first v0.9.0 `setup:report-views:apply` action failed while patching `📊 Client Metrics` with Lark code `1254001 WrongRequestBody`. The failure reported `appliedActionCount=0`, so no managed View was changed and no rollback is required.

## Root cause

The View PATCH adapter sent filter conditions with only `field_id`, `operator`, and a raw scalar `value`. The Lark View contract expects:

- numeric `field_type`
- `value` as a string containing a JSON array
- SingleSelect filters using the live option ID rather than only the display name

## Fix

- Resolve every filter field from live Field metadata.
- Include its numeric type in the mutation.
- Resolve SingleSelect names to the live option IDs and fail closed if resolution is ambiguous or missing.
- Canonicalize Checkbox values to `true`/`false` strings inside the encoded array.
- Normalize API responses to the same canonical shape so the post-Apply Preview is idempotent.
- Preserve read-only Preview, explicit Apply confirmation, no-delete behavior, and action-level error context.

## Operator sequence

```bash
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
npm run setup:report-views
```

The final Preview must report zero create/update actions and zero conflicts. Keep both Report schedule flags disabled until this verification is clean.
