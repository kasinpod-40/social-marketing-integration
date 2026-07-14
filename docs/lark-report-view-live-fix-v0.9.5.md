# Lark Report View Live Fix — v0.9.5

## Confirmed causes

The official Update View request condition contains only `field_id`, `operator`, and optional `value`. Fields such as `field_type`, `condition_id`, and `condition_omitted` belong to responses and are not sent back in PATCH.

Checkbox filter values must keep their boolean type inside Lark's JSON-array string:

```json
{
  "field_id": "fld...",
  "operator": "is",
  "value": "[true]"
}
```

SingleSelect values remain JSON-array strings containing live option IDs, for example `["opt..."]`.

## Verification behavior

This tenant's List Views endpoint returns View identity but omits `property`. The installer therefore calls Get View for each managed View before comparing Filters. This prevents a successful Apply from appearing as six repeated updates.

## Live result — 2026-07-14

- Updated `📊 Client Metrics` and `🏆 Top Content`.
- Created and filtered `📊 Daily Metrics`, `📈 Weekly Metrics`, `🏆 Daily Top Content`, and `🏅 Weekly Top Content`.
- Get View confirmed all Checkbox and SingleSelect Filters.
- Filter and Hidden fields are applied in separate PATCH requests and verified idempotently.
- Final Preview: `createViews=0`, `updateViews=0`, `conflicts=0`, `warnings=0`.

`rank` ascending Sort and customer Production permissions remain explicit Lark UI actions reported by `manualActions`.
