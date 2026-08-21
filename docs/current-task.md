# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = AUTOMATIC_PASS_VIEW_UI_CLOSURE
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_TABLES                        = 32
CLONE_VIEWS                         = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = IMMUTABLE_REUSE_ONLY
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7
CURRENT_SOURCE_PATH                 = /Users/wasanjantawong/Desktop/Social MKT Data Hub.base
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN_FILTER_HIERARCHY        = AUTOMATIC_PASS
VIEW_JS_SDK_UI_PARITY               = CI_VERIFIED_PENDING_LIVE_UI_RUN
VIEW_FIELD_ORDER                    = MANUAL_AUDIT
VIEW_FROZEN_COLUMNS                 = MANUAL
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

Final GET-only canonical verification passed:

```json
{
  "ok": true,
  "stage": "final-canonical-verify-only",
  "status": "PASS",
  "mismatchCount": 0,
  "manualFormulaPresentationMismatches": 4,
  "manualViewFilterRequirements": 1,
  "remoteMutationCount": 0,
  "applyExecuted": false
}
```

Table / Field / Record / Relation / Formula-definition / supported View parity is closed. Do not rerun `customer-base-controlled-apply.mjs --apply`.

Immutable recovery evidence:

- checkpoint `$HOME/Downloads/customer-base-controlled-apply-checkpoint.json`;
- checkpoint SHA `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`;
- historical baseline Source SHA `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`;
- current Source SHA `1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`;
- `🎵 RAW_TikTok_Creator_Videos` remains protected/zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete.

**Never create a new checkpoint. Never rerun controlled Apply after this PASS.**

## Advanced Permission

The four exported Role definitions are inactive/unassigned for this migration scope: zero members and zero Dashboard Role assignments. They are not materialized. Existing Target Roles remain untouched and `base:role:create` is not required.

## View parity ownership

### Closed Server OpenAPI dimensions

- hidden fields — automatic PASS;
- supported filters — automatic PASS;
- hierarchy — documented write/readback PASS.

The Base JS SDK runner treats hidden state as verify-only and does not rewrite hidden/filter/hierarchy state through a second path.

### Base JS SDK UI-owned dimensions

The retained export contains UI properties for which Server OpenAPI had no authorized write payload. Current documented Base frontend plugin SDK provides direct View methods for a subset of those dimensions. The UI runner may reconcile only:

- sort: 41 Source Views;
- group: 4 Source Views;
- explicit non-null column width: 70 Views / 898 assignments;
- row height: 110 Views, all level 1.

Implementation:

- `scripts/lib/lark-base-view-js-sdk-parity.js` — converts the retained names-only View manifest to SDK actions;
- `scripts/customer-base-view-ui-parity-server.mjs` — localhost Source-authority and plan-count gate;
- `scripts/customer-base-view-ui-parity.browser.js` — Target preflight + SDK mutation/readback;
- `tests/scripts/lark-base-view-js-sdk-parity.test.js` — direction/width/row-height fail-closed regression;
- `docs/project-brain/customer-base-view-js-sdk-ui-parity-2026-08-21.md` — ownership and safety evidence.

The browser pins `@lark-base-open/js-sdk@1.0.2` and uses only documented frontend plugin methods.

### Full preflight before first UI mutation

The runner must prove all of the following before it changes any View setting:

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

No documented Base JS SDK setter is authorized for:

- field/column order — Source authority covers 110 Views; ordered SDK `getFieldMetaList()` is used to count exact mismatches;
- frozen-column count — 110 Views, Source count 1 each.

Only `⚙️ MKT_Report_Settings` has multiple Source field-order templates across its Views. Every other clone Table has one Source order template shared by its Views, although Lark stores layout per View.

Other UI-only work after View runner:

- Formula presentation 4;
- one `TheLastMonth` dynamic-date View filter;
- Dashboards 6 / 75 charts;
- Workflows 2;
- one final Target `.base` export and local manual-owned parity verification.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
5. Never retry legacy Formula presentation PUT.
6. Never rewrite hidden/filter/hierarchy from the JS SDK runner; hidden is verification-only there.
7. Never guess a Server OpenAPI payload for field order, widths, row height, frozen columns, Dashboard or Workflow.
8. Never create inactive exported Advanced Permission Roles.
9. PR #661 stays Draft/Open/Unmerged until all UI/manual gates and final export verification close.

## Required closure sequence

1. Require full Branch Verification SUCCESS on the final runner/docs HEAD.
2. Start the localhost runner against the exact current Source export.
3. Add/open that localhost URL as a Base extension script inside the exact customer Target Base.
4. Run supported View UI parity once; return only its compact summary JSON.
5. Use the exact reported field-order mismatch count to finish only remaining field-order work; frozen columns remain manual.
6. Complete Formula presentation 4 and dynamic-date filter 1.
7. Recreate/verify Dashboards 6 / 75 charts and Workflows 2 through supported UI/source reference.
8. Export Target once and verify manual-owned View dimensions locally.
9. Ready/Merge PR #661 only after every gate closes and only on explicit user instruction.

## Implementation result

Base JS SDK View UI runner implementation milestone:

```text
HEAD                          1defc9a9150466a5327c8bc3576b320b9e80460d
Branch Verification Run       32437745565
Job                           96642309124
Result                        SUCCESS
```

Passed on that implementation HEAD:

- locked dependency install;
- syntax / architecture / repository hygiene;
- focused Report / Meta / Woo / Chatwoot / TikTok suites;
- full Unit + Workers runtime, including the new View-plan regressions;
- Report reliability regression;
- dependency audit;
- Wrangler dry-run;
- diff whitespace and diagnostics/post steps.

This documentation closeout follows the verified implementation without changing runner behavior. A final Branch Verification SUCCESS on the resulting PR HEAD is still required before live UI execution.
