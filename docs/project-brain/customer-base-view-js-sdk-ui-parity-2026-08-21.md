# Customer Base View JS SDK UI Parity — 2026-08-21

## Context

Automatic customer Base migration is closed. The final canonical GET-only verifier passed with mismatch count `0`; no further controlled `--apply` is authorized. The original checkpoint is immutable and must never be recreated.

Server OpenAPI remains authoritative for hidden fields, filters and hierarchy. Those dimensions already passed automatic verification. The Base JS SDK runner is only for documented frontend-plugin View capabilities.

Pinned SDK runtime:

```text
@lark-base-open/js-sdk 1.0.2
```

Documented methods used by the runner:

- `getFieldMetaList()` — ordered UI readback;
- `getSortInfo()` / `deleteSort()` / `addSort()`;
- `getGroupInfo()` / `deleteGroup()` / `addGroup()`;
- `getFieldWidth()` / `setFieldWidth()`;
- `setRowHeight()`;
- `applySetting()`;
- `getVisibleFieldIdList()` for hidden-field verification only.

The runner never owns Record, Field-schema, Formula, Filter, hierarchy, Role, Table-create/delete or View-create/delete mutations.

## Current Source authority

The live local Source observed on 2026-08-21 is:

```text
file                         Social MKT Data Hub.base
SHA-256                      9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
Records                      36,552
Tables                       33
Fields                       723
Views                        111
Relations                     12
Formulas                       4
Dashboards                     6
Workflows                      2
Advanced Permission roles      4
clone Tables                  32
clone Views                  110
```

This Source passes the existing refresh-compatible structural boundary and exact checkpoint clone-scope Table-name set.

## Retained layout evidence vs current refresh revision

The historical retained manifest evidence contains:

```text
sort Views                    41
metric_date DESC              18
generated_at DESC             13
rank ASC                       5
last_order_at DESC             1
last_activity_at DESC          1
rank DESC                      1
source_created_at DESC         1
source_modified_at DESC        1
```

The retained manifest file itself is not available in the current local search locations. A read-only diagnostic of current Source SHA `9c24...` proved that every aggregate View dimension remained identical except one additional sort:

```text
🎬 MKT_Content → 🔵 Facebook Content → published_at DESC
```

Current Source therefore contains exactly 42 sorted Views. The complete diagnostic inventory showed the retained eight profile counts unchanged plus `published_at DESC = 1`.

## Exact refreshed-layout admission

The current revision is not admitted by weakening `sortViews` from 41 to any arbitrary value. `assessLarkBaseViewUiPlanAuthority()` keeps two fail-closed modes:

1. all unknown refresh SHAs use retained layout counts and still require `sortViews = 41`;
2. exact Source SHA `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7` uses one evidence-backed layout revision with `sortViews = 42`.

For that exact SHA, the runner additionally requires the complete sorted-View inventory fingerprint:

```text
961936df36fdf70b4cb2df434638630e699b573c26166b4aff04f0f58ecfbf88
```

The fingerprint is computed from every sorted View's Table name, View name, sort Field name and direction. Any replacement, removal or unrelated addition fails even if the aggregate remains 42.

All other plan dimensions remain exact:

```text
clone Tables                 32
clone Views                 110
field-order audit Views     110
hidden verify Views          11
hidden assignments           85
group Views                   4
column-width Views           70
column-width assignments    898
row-height Views            110
frozen manual Views         110
```

This is a narrow content-addressed layout revision, not a general plan-count relaxation.

## Source resolver behavior

`scripts/customer-base-view-ui-parity-server.mjs` now:

1. verifies the immutable original checkpoint SHA and baseline Source authority;
2. discovers `Social MKT Data Hub*.base` from Desktop and Downloads unless explicitly configured;
3. requires refresh-compatible structural counts and record floor;
4. excludes protected `🎵 RAW_TikTok_Creator_Videos`;
5. requires exact checkpoint 32-Table clone-scope name set;
6. evaluates the View plan through the shared exact layout authority function;
7. rejects unknown 42-sort Sources;
8. rejects exact `9c24...` if the complete 42-sort inventory fingerprint differs;
9. rejects multiple compatible exports whose full View UI plan fingerprints differ;
10. reports `sourcePlanAuthorityMode` and `sortViews` in its READY summary.

The local read-only diagnostic uses the same authority function, so it no longer reports the approved `9c24...` layout as blocked.

## Target preflight before first UI mutation

The browser runner must prove all of the following before any View setting changes:

1. current Base is editable;
2. Target contains all four identity anchor Tables:
   - `🎵 RAW_TikTok_Creator_Videos`;
   - `(VDO) Content Creator`;
   - `(Graphic) Content Creator`;
   - `คำถามจาก Sale & Support`;
3. all exact 32 clone Table names exist;
4. all exact 110 planned Views and referenced Fields exist;
5. hidden-field membership still matches automatic-pass state;
6. every SDK capability needed by the whole plan is available.

Only after complete preflight may it reconcile Sort / Group / explicit Column width / Row height.

## Remaining manual/audit ownership

No documented setter was found for:

- field order / column reorder;
- frozen-column count.

These remain manual/audit. Formula presentation 4, one dynamic-date filter, Dashboards 6 / 75 charts and Workflows 2 also remain separate closure work.

## No-repeat rules

- never prepare another checkpoint;
- never rerun controlled Apply;
- never delete/recreate successful migration state;
- never mutate Source, Worker, D1, Queue, schedule or deployment here;
- never rewrite hidden/filter/hierarchy through the JS SDK runner;
- never guess undocumented setters for field order, frozen columns, Dashboard or Workflow;
- PR #661 remains Draft/Open/Unmerged until all UI/manual and final-export gates close.
