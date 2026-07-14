# Lark Report View Filter-only PATCH — v0.9.4 (historical failed hypothesis)

> Superseded by `lark-report-view-live-fix-v0.9.5.md`. Live v0.9.4 still failed because the request echoed response-only fields and encoded Checkbox as text.

## Context

Live Apply attempts in v0.9.0–v0.9.3 all failed on the first existing View with Lark code `1254001 WrongRequestBody`. Each failure reported `appliedActionCount=0`, so no existing View was changed. The earlier releases changed one hypothesis at a time, but the tenant continued to reject a combined View mutation containing Filter and Hidden fields.

## Contract hypothesis used in this release

This release incorrectly treated response metadata as request fields and serialized conditions with:

```json
{
  "field_id": "fld...",
  "field_type": "7",
  "operator": "is",
  "value": "[\"true\"]"
}
```

and emitted `condition_omitted: false`. The official request type accepts only `field_id`, `operator`, and optional `value`; v0.9.5 corrects this.

## Isolation strategy

The Apply path now uses the smallest mutation needed for report correctness:

```json
{
  "property": {
    "filter_info": {
      "conjunction": "and",
      "conditions": [],
      "condition_omitted": false
    }
  }
}
```

It intentionally does not send `view_name` or `hidden_fields` in PATCH. Missing Views are created first with name/type, then filtered in a separate request. Hidden columns and `rank` sort are explicit Lark UI actions. This prevents cosmetic View settings from blocking report filtering or schedule activation and makes any remaining API rejection attributable to the Filter contract alone.

## Safety and recovery

- Preview remains read-only.
- Existing Views and Report records are never deleted.
- Filter comparison remains idempotent; Hidden-field drift does not trigger repeated PATCH actions.
- If Create succeeds but Filter PATCH fails, diagnostics include `viewCreatedBeforeFailure`, `createdViewId`, and `viewMutationStage=filter`. The next Preview resolves the created View by name and safely resumes with an update.
- Error diagnostics include the exact non-secret `viewMutationBody`.

## Manual actions after Apply

For each managed View:

1. Hide the technical fields listed in `VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED`.
2. Sort `rank` ascending.
3. Configure customer permissions only during customer-owned Production deployment.
