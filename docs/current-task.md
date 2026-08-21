# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = AUTOMATIC_PASS_VIEW_FUNCTIONAL_PASS_DYNAMIC_FILTER_READY
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
CLONE_TABLES                        = 32
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
CURRENT_SOURCE_RECORDS              = 36552
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN                         = PASS_0_MISMATCH
VIEW_SORT                           = PASS_42_VIEWS_0_MISMATCH
VIEW_GROUP                          = PASS_4_VIEWS_0_MISMATCH
VIEW_COLUMN_WIDTH                   = IGNORED_COSMETIC_BY_USER
VIEW_ROW_HEIGHT                     = IGNORED_COSMETIC_BY_USER
VIEW_FIELD_ORDER                    = PRESENTATION_ONLY_105_MISMATCH_VIEWS
VIEW_FROZEN_COLUMNS                 = PRESENTATION_ONLY_110_VIEWS
FORMULA_DEFINITION                  = AUTOMATIC_PASS_DO_NOT_REWRITE
FORMULA_PRESENTATION                = SOURCE_DIAGNOSTIC_READY_UI_4
DYNAMIC_DATE_VIEW_FILTER            = SDK_EXACT_ONE_VIEW_READY_FOR_LIVE
DASHBOARDS                          = MANUAL_UI_6_75_CHARTS
WORKFLOWS                           = MANUAL_UI_2
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_REMAINING_UI_AND_FINAL_EXPORT
```

## Objective

Close the remaining customer-owned Lark Base UI parity after the automatic migration and functional View parity have passed. Do not reopen migration-owned Table/Field/Record/Formula-definition state and do not touch Worker, D1, Queue, schedule or deployment.

## Closed — never rerun

The automatic migration is closed. Final canonical GET verification passed with mismatch count `0` across the clone scope. The original checkpoint is immutable and must never be recreated.

Closed automatic state:

- 32 clone Tables and all migration-owned Fields/Records;
- Relations and Formula definitions;
- supported View filters and hierarchy;
- hidden fields;
- Advanced Permission parity already covered by the controlled migration flow;
- protected `🎵 RAW_TikTok_Creator_Videos` remains zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete.

Closed Base JS SDK functional View state from live Target readback:

```text
hidden verify mismatch        0
sort mismatch                 0 / 42 Views
group mismatch                0 / 4 Views
```

Do not run the Sort/Group mutation runner again.

## Cosmetic View dimensions removed from parity gate

The user explicitly confirmed that historical Column Width and Row Height values were incidental resizing/appearance changes. They are not business/data requirements and are removed from execution, authority and closure gates.

```text
Column Width                  ignored cosmetic
Row Height                    ignored cosmetic
```

Field order and frozen columns remain presentation-only observations because the SDK has no documented setter. They do not block the current functional-data work:

```text
Field order mismatches        105 Views
Frozen columns                110 Views
```

Do not invent undocumented setters for them.

## Formula presentation — exact four-field UI ownership

Formula expressions/definitions already passed automatic canonical verification and must not be rewritten, deleted or recreated. The only remaining Formula scope is presentation metadata for exactly:

1. `📣 MKT_Ads_Campaigns.budget`
2. `📈 MKT_Ads_Daily.all_conversion_value`
3. `📈 MKT_Ads_Daily.cost_per_conversion`
4. `📈 MKT_Ads_Daily.conversion_rate`

`scripts/customer-base-formula-presentation-source-diagnostic.mjs` is local/read-only and is fenced to current Source SHA:

```text
9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
```

It reuses the shared `normalizeLarkFieldProperty()` Formula canonicalization, strips `formula_expression`, requires the exact four approved Formula identities, and reports only presentation metadata needed for UI closeout. It performs zero remote requests and mutations.

Historical UI evidence expects display formats `0.00`, `0.00`, `0.00`, `0.00%`, but current exact Source diagnostic remains the authority for any richer `data_type / ui_type / currency_code / formatter` presentation before UI changes.

## Dynamic Date filter — exact one-view SDK recovery

The exact current Source contract is:

```text
Table                         📈 MKT_Ads_Daily
View                          📈 Google Ads Daily 30D
Conjunction                   AND
Condition 1                   platform is google_ads
Condition 2                   metric_date is TheLastMonth
```

`TheLastMonth` is the single dynamic Date token that the Server OpenAPI projection intentionally omitted in full rather than writing a partial filter. Current regression evidence is `tests/application/lark-base-view-filter-manual-parity.test.js`.

The existing same-origin Base extension runner is now narrowed to this one filter only. Before mutation it requires:

1. editable Target Base;
2. all four immutable Target identity anchors;
3. exact 32 clone Table-name scope from the admitted Source plan;
4. exact `📈 MKT_Ads_Daily` / `📈 Google Ads Daily 30D` identity;
5. `platform` is SingleSelect and contains exactly one Target option named `google_ads`;
6. `metric_date` is DateTime;
7. documented filter SDK methods are present.

Safety behavior:

- if readback is already exact → PASS with zero mutation;
- if filter is null/empty → add the exact two conditions, set AND, `applySetting()`, then read back;
- if any non-empty different filter exists → fail closed with `DYNAMIC_DATE_FILTER_EXISTING_STATE_CONFLICT`; do not overwrite;
- no Sort/Group/Hidden/Width/RowHeight method is called;
- no Record, Field schema, Formula, Role, Table or View create/delete method is called.

Expected successful live status:

```text
DYNAMIC_DATE_FILTER_PASS
```

## Remaining after Formula + dynamic filter

After these two gates close, meaningful remaining work is:

1. Dashboards — 6 / 75 charts, reconstruct/verify through supported Lark UI/source reference;
2. Workflows — 2, reconstruct/verify through supported Lark UI/source reference while preserving intended enabled/disabled state;
3. one final Target `.base` export and final parity verification;
4. Ready/Merge PR #661 only on explicit user instruction after all closure evidence is retained.

## No-repeat rules

1. Never create a new checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never rewrite the four Formula definitions during presentation closeout.
5. Never rerun the already-passed Sort/Group runner.
6. Never restore Width/RowHeight as parity requirements.
7. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
8. Never overwrite a non-empty conflicting dynamic filter; stop and inspect instead.
9. Never invent undocumented field-order/frozen-column/Dashboard/Workflow write payloads.
10. PR #661 remains Draft/Open/Unmerged until explicit final authorization.

## Required next sequence

1. Run focused tests on the final branch HEAD.
2. Run the Source Formula presentation diagnostic locally; require exact current Source SHA and exactly four Formula identities.
3. Require Branch Verification SUCCESS on that same exact HEAD.
4. Start the existing local Base extension server using the immutable checkpoint only as a Target-scope fence.
5. Require `browser-module-loaded` from the exact customer Target.
6. Click `ตั้ง Dynamic Date Filter` once and retain the compact readback JSON; do not click again after PASS or ERROR.
7. Use the Source diagnostic output to close only Formula presentation in Lark UI, without editing Formula expressions.
8. Proceed to Dashboard 6 / 75 charts and Workflow 2 closure.
9. Export Target once for final verification.
10. Ready/Merge PR #661 only after explicit user instruction.
