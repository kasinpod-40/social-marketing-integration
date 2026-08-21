# Customer Base functional View + dynamic filter closure — 2026-08-21

## Live functional View evidence

Customer Target `✨Marketing Content Calendar` passed the Base JS SDK functional View closeout with compact live readback:

```text
status                       SUPPORTED_UI_PASS
mode                         base-js-sdk-write-and-readback
hiddenVerifyMismatchViews    0
sortMismatchViews            0 / 42 Views
groupMismatchViews           0 / 4 Views
Table mutation               0
Field mutation               0
Record mutation              0
```

This is terminal evidence for Sort/Group. Do not run that mutation path again.

The Source authority for this run was current refresh export SHA:

```text
9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
```

Its exact 42-sort inventory fingerprint remains:

```text
961936df36fdf70b4cb2df434638630e699b573c26166b4aff04f0f58ecfbf88
```

## Cosmetic scope decision

The user explicitly confirmed that historical Row Height and Column Width values came from incidental resizing in the old Base and are not business/data requirements.

Therefore:

- Column Width is non-authoritative cosmetic;
- Row Height is non-authoritative cosmetic;
- neither participates in execution, authority admission, PASS/FAIL or remaining manual workload;
- no future recovery should restore them as a gate.

Field order and frozen columns remain presentation-only observations because there is no documented setter. Latest read-only counts after functional View PASS were:

```text
fieldOrderMismatchViews      105
frozenColumnViews            110
```

They are not to be mutated through guessed SDK/OpenAPI methods.

## Formula presentation boundary

Formula definition/expression parity is already closed by canonical automatic verification. The remaining Formula scope is presentation only for exactly four fields:

1. `📣 MKT_Ads_Campaigns.budget`
2. `📈 MKT_Ads_Daily.all_conversion_value`
3. `📈 MKT_Ads_Daily.cost_per_conversion`
4. `📈 MKT_Ads_Daily.conversion_rate`

The new local diagnostic:

```text
scripts/customer-base-formula-presentation-source-diagnostic.mjs
```

is fenced to Source SHA `9c24...267f7`, performs zero remote requests/mutations and reuses the same shared Formula canonicalization used by the canonical verifier. It strips `formula_expression` and outputs only presentation metadata.

No Formula Field may be deleted/recreated or have its expression rewritten during presentation closeout. In particular, existing Target `📣 MKT_Ads_Campaigns.budget` remains protected from destructive recovery.

## Exact dynamic Date filter recovery

The one dynamic filter excluded from Server OpenAPI automatic writes is:

```text
Table        📈 MKT_Ads_Daily
View         📈 Google Ads Daily 30D
AND
platform     is google_ads
metric_date  is TheLastMonth
```

Repository regression `tests/application/lark-base-view-filter-manual-parity.test.js` encodes this exact Source contract. The whole mixed filter was projected to `null` during automatic writes because `TheLastMonth` was intentionally UI-owned; the platform predicate was not partially written.

The existing browser runner is now repurposed narrowly for this exact one View. It imports pinned same-origin `@lark-base-open/js-sdk@1.0.2` and uses documented filter methods only.

Fail-closed behavior:

1. full Target identity/scope/type/option capability preflight;
2. read current filter first;
3. already exact → PASS zero-write;
4. null/empty → add exact two conditions + set AND + applySetting + readback;
5. non-empty but different → `DYNAMIC_DATE_FILTER_EXISTING_STATE_CONFLICT`, no overwrite;
6. no delete/update filter calls;
7. no Sort/Group/Hidden/Width/RowHeight calls;
8. no Record/Field-schema/Formula/Role/Table/View create-delete calls.

Expected terminal status after live readback:

```text
DYNAMIC_DATE_FILTER_PASS
```

## Remaining closure after this stage

After Formula presentation 4 and this dynamic filter pass:

- Dashboards 6 / 75 charts;
- Workflows 2;
- one final Target `.base` export and parity check;
- Ready/Merge PR #661 only after explicit user authorization.

## No-repeat rules

- never prepare another checkpoint;
- never rerun controlled Apply;
- never rerun Sort/Group after the retained PASS;
- never restore Width/RowHeight as parity work;
- never rewrite Formula expressions while changing presentation;
- never overwrite a non-empty conflicting dynamic filter;
- never touch Source, Worker, D1, Queue, schedule or deployment in this UI closeout.
