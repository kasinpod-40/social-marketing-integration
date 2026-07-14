# Lark Report View Primary Field Fix v0.9.3

> Historical note: this release tested one hypothesis against generic `1254001`. Live Apply still failed. The current contract and isolation strategy are documented in `lark-report-view-filter-only-patch-v0.9.4.md`.


## Live symptom

The first managed View update returned Lark code `1254001 WrongRequestBody` with `appliedActionCount=0`. The safe diagnostic body showed that `hidden_fields` contained the table's Primary/Index field.

## Root cause

Lark Base does not allow the first Primary/Index field to be hidden. The managed contracts attempted to hide:

- `report_metric_key` in `MKT_Report_Metric_Values`
- `report_content_key` in `MKT_Report_Top_Content`

The filter request shape from v0.9.2 remains valid and is retained.

## Fix

- Removed both Primary fields from the six managed View hidden-field lists.
- Added a metadata-based runtime guard using `isPrimary` from Lark Field metadata.
- A future contract that requests a Primary field to be hidden is sanitized before mutation and emits `VIEW_PRIMARY_FIELD_CANNOT_BE_HIDDEN`.
- No table, field, record, or existing View is deleted.

## Operational recovery

Because the failed run reported `appliedActionCount=0`, no rollback is required. Run Preview, Apply, then Preview again to confirm `actions: []`.

## Known UX limitation

The technical Primary field remains visible in Lark grid Views. For customer Production, prefer a client-facing Interface/dashboard or plan a controlled schema migration to a client-friendly Primary label while keeping the stable upsert key in a separate field.
