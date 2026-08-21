# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = AUTOMATIC_PASS_VIEW_UI_LIVE_CLOSURE_READY
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_TABLES                        = 32
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
CURRENT_SOURCE_RECORDS              = 36552
CURRENT_SOURCE_AUTHORITY            = REFRESH_COMPATIBLE_EXACT_LAYOUT_REVISION
CURRENT_SOURCE_SEARCH               = Desktop + Downloads / Social MKT Data Hub*.base
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN_FILTER_HIERARCHY        = AUTOMATIC_PASS
VIEW_JS_SDK_UI_PARITY               = FINAL_RUNNER_FIX_PENDING_BRANCH_VERIFICATION
VIEW_FIELD_ORDER                    = SDK_AUDIT_NO_DOCUMENTED_SETTER
VIEW_FROZEN_COLUMNS                 = MANUAL_NO_DOCUMENTED_SETTER
FORMULA_PRESENTATION                = MANUAL_UI_4
DYNAMIC_DATE_VIEW_FILTER            = MANUAL_UI_1
DASHBOARDS                          = MANUAL_UI_6_75_CHARTS
WORKFLOWS                           = MANUAL_UI_2
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_UI_PARITY_AND_FINAL_EXPORT
```

## Objective

Close the remaining functional/UI parity of the approved `Social MKT Data Hub` migration inside customer Base `✨Marketing Content Calendar` without reopening the completed automatic migration or modifying pre-existing customer resources.

## Automatic migration — closed

Final GET-only canonical verification passed with mismatch count `0`. Table / Field / Record / Relation / Formula-definition / supported View parity is closed.

Immutable recovery evidence:

- checkpoint `$HOME/Downloads/customer-base-controlled-apply-checkpoint.json`;
- checkpoint SHA `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`;
- historical baseline Source SHA `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`;
- `🎵 RAW_TikTok_Creator_Videos` remains protected/zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete.

**Never create a new checkpoint. Never rerun controlled Apply after the canonical PASS.**

## View parity ownership

### Closed Server OpenAPI dimensions

- hidden fields — automatic PASS;
- supported filters — automatic PASS;
- hierarchy — documented write/readback PASS.

The Base JS SDK runner treats hidden state as verify-only and does not rewrite hidden/filter/hierarchy through a second path.

### Base JS SDK UI-owned dimensions

Current refresh Source `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7` resolves to:

- sort: **42 Views**;
- group: 4 Views;
- explicit column width: 70 Views / 898 assignments;
- row height: 110 Views, all level 1;
- hidden verify-only inventory: 11 Views / 85 assignments;
- field-order audit: 110 Views;
- frozen columns manual: 110 Views.

The only sort delta from the retained 41-View evidence is:

```text
🎬 MKT_Content → 🔵 Facebook Content → published_at DESC
```

All retained sort profile counts remain unchanged, plus `published_at DESC = 1`.

## Exact refreshed layout authority

The retained manual manifest file is no longer present locally, so the live runner does not pretend that it can load that historical file. Instead, the current Source revision is admitted fail-closed by exact evidence:

```text
current Source SHA-256       9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7
Tables                       33
Fields                       723
Views                        111
Relations                     12
Formulas                       4
Dashboards                     6
Workflows                      2
Advanced Permission roles      4
Records                    36,552
clone Tables                  32
clone Views                  110
sort Views                    42
sort inventory fingerprint    961936df36fdf70b4cb2df434638630e699b573c26166b4aff04f0f58ecfbf88
```

Admission rules in `assessLarkBaseViewUiPlanAuthority()`:

1. unknown refresh SHAs remain on the retained count authority and therefore still require sort count `41`;
2. only exact Source SHA `9c24...` may use the 42-sort revision;
3. all other retained plan counts must remain exact, including hidden verify-only `11 / 85`, group `4`, widths `70 / 898`, row height `110`, field-order audit `110`, frozen manual `110`;
4. the complete 42-View sort inventory is content-fingerprinted; changing any Table/View/sort field/direction fails admission even if the aggregate remains 42;
5. clone-scope Table names must still exactly match the immutable checkpoint;
6. structural authority still requires 33 / 723 / 111 / 12 / 4 / 6 / 2 / 4 with Records `>= 35,528`;
7. multiple compatible exports with different full View UI plan fingerprints still fail ambiguous before any Lark mutation.

This is an exact revision admission, not a relaxation of the retained parity gate.

## Operators

- `scripts/lib/lark-base-view-js-sdk-parity.js` — names-only plan projection, structural admission and exact layout-revision authority;
- `scripts/customer-base-view-ui-parity-server.mjs` — checkpoint fence, Source discovery/admission and localhost runner;
- `scripts/customer-base-view-ui-parity.browser.js` — exact Target preflight + supported SDK mutation/readback;
- `scripts/customer-base-view-ui-source-diagnostic.mjs` — local read-only Source/layout diagnostic using the same authority function;
- `tests/scripts/lark-base-view-js-sdk-parity.test.js` — normalization, structural admission and exact 42-sort inventory regressions.

## Full preflight before first UI mutation

The browser runner must prove all of the following before it changes any View setting:

1. current Base is editable;
2. Target contains all four identity anchors:
   - `🎵 RAW_TikTok_Creator_Videos`;
   - `(VDO) Content Creator`;
   - `(Graphic) Content Creator`;
   - `คำถามจาก Sale & Support`;
3. exact 32 clone Table names are present;
4. exact 110 planned Views and every referenced Field name are present;
5. hidden-field membership still matches the already-passed automatic state;
6. every SDK capability required by the full plan is available.

Only after complete preflight may it reconcile sort/group/width/row-height. It never calls Record, Field-schema, Formula, Filter, hierarchy, Role, Table-create/delete or View-create/delete mutation methods.

## Remaining manual dimensions

Official Base JS SDK exposes ordered field readback but no documented setter for field order or frozen-column count. Therefore:

- field/column order — audit exact mismatch count across 110 Views;
- frozen-column count — 110 Views, Source count 1 each;
- Formula presentation — 4;
- dynamic-date `TheLastMonth` View filter — 1;
- Dashboards — 6 / 75 charts;
- Workflows — 2;
- one final Target `.base` export and local manual-owned parity verification.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
5. Never retry legacy Formula presentation PUT.
6. Never rewrite hidden/filter/hierarchy from the JS SDK runner; hidden is verification-only there.
7. Never guess an undocumented payload/setter for field order, frozen columns, Dashboard or Workflow.
8. Never create inactive exported Advanced Permission Roles.
9. Do not run the live UI mutation until Branch Verification is SUCCESS on the final runner/docs HEAD.
10. PR #661 stays Draft/Open/Unmerged until all UI/manual gates and final export verification close.

## Required closure sequence

1. Require full Branch Verification SUCCESS on the final runner/docs HEAD.
2. Start `scripts/customer-base-view-ui-parity-server.mjs`; require `status=READY`, exact Source SHA `9c24...`, `sourcePlanAuthorityMode=exact-refresh-layout-revision-facebook-content-published-at-desc`, and `sortViews=42`.
3. Add/open `http://127.0.0.1:4173` as a Base extension script inside the exact customer Target Base.
4. Run supported View UI parity once and retain its compact summary JSON.
5. Use the reported field-order mismatch count to finish only actual remaining field-order work; frozen columns remain manual.
6. Complete Formula presentation 4 and dynamic-date filter 1.
7. Recreate/verify Dashboards 6 / 75 charts and Workflows 2 through supported UI/source reference.
8. Export Target once and verify all manual-owned View dimensions locally.
9. Ready/Merge PR #661 only after every gate closes and only on explicit user instruction.
