# Customer Base View JS SDK UI Parity — 2026-08-21

## Context

Automatic customer Base migration is closed. The final canonical GET-only verifier passed with:

```text
ok                         true
status                     PASS
mismatchCount              0
remoteMutationCount        0
applyExecuted              false
```

No further controlled `--apply` is authorized. The original checkpoint remains immutable and must never be recreated.

The retained View manual manifest still represents 32 clone Tables / 110 Views. Server OpenAPI already owns hidden fields, filters and hierarchy and those dimensions passed canonical verification.

## Refined UI ownership

The earlier manual View procedure was intentionally conservative because it authorized only proven Server OpenAPI request contracts. Base frontend plugins expose a separate documented Base JS SDK surface. Using that surface does not introduce guessed OpenAPI payloads and does not reopen the migration engine.

Pinned SDK runtime:

```text
@lark-base-open/js-sdk 1.0.2
```

Documented Grid View methods used by the UI runner:

- `getFieldMetaList()` — ordered as displayed in the UI;
- `getSortInfo()` / `deleteSort()` / `addSort()`;
- `getGroupInfo()` / `deleteGroup()` / `addGroup()`;
- `getFieldWidth()` / `setFieldWidth()`;
- `setRowHeight()`;
- `applySetting()`;
- `getVisibleFieldIdList()` for hidden-field verification only.

### Server OpenAPI remains automatic-owned

- hidden fields — verify-only in the JS SDK runner; never rewritten by the second path;
- filters — untouched by the JS SDK runner;
- hierarchy — untouched by the JS SDK runner.

### Base JS SDK UI-owned mutation

The runner may reconcile only:

- sort;
- group;
- explicit non-null column width;
- row height.

The retained Source manifest is converted to names-only SDK actions. Target Table/View/Field IDs are resolved inside the currently open Base only after target-identity preflight.

### Remaining manual

No documented setter was found for:

- field order / column reorder;
- frozen-column count.

These remain manual/audit dimensions. The JS SDK `getFieldMetaList()` supplies ordered UI readback so field-order mismatches can be counted exactly after supported SDK mutations.

Formula presentation 4, the single dynamic-date filter, Dashboards 6 / 75 charts and Workflows 2 remain separate closure work.

## Safety gates

Before any Base JS SDK mutation the runner must:

1. require `bitable.base.isEditable()`;
2. require the four Target identity anchor Tables:
   - `🎵 RAW_TikTok_Creator_Videos`;
   - `(VDO) Content Creator`;
   - `(Graphic) Content Creator`;
   - `คำถามจาก Sale & Support`;
3. require every exact clone-scope Table name from the Source plan;
4. require every exact View and referenced Field name;
5. verify hidden-field membership still matches the already-passed automatic state;
6. require SDK methods for every planned mutation before starting writes.

The runner never calls record, field-schema, Formula, filter, hierarchy, Role, Table-create/delete or View-create/delete mutation methods.

## Source authority and plan counts

The local server accepts only the current approved Source export SHA:

```text
1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7
```

Structural authority remains:

```text
Tables                     33
Fields                     723
Views                      111
Relations                   12
Formulas                     4
Dashboards                   6
Workflows                    2
clone Tables                32
clone Views                110
field-order audit Views    110
sort Views                  41
group Views                  4
width Views                 70
width assignments          898
row-height Views           110
frozen manual Views        110
```

Any count drift blocks the local UI runner before the Base plugin is served.

## Operator surface

- `scripts/lib/lark-base-view-js-sdk-parity.js` — pure names-only plan projection;
- `scripts/customer-base-view-ui-parity-server.mjs` — localhost plan/UI server with exact Source gate;
- `scripts/customer-base-view-ui-parity.browser.js` — Base JS SDK preflight, supported mutation and readback;
- `tests/scripts/lark-base-view-js-sdk-parity.test.js` — normalization/fail-closed regression.

The browser UI always ends with a compact `=== COPY THIS SUMMARY JSON ===` block for the operator to return without copying full diagnostics.
