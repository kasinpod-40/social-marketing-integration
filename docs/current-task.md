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
CURRENT_SOURCE_AUTHORITY            = REFRESH_COMPATIBLE_AUTO_DISCOVERY
CURRENT_SOURCE_SEARCH               = Desktop + Downloads / Social MKT Data Hub*.base
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
VIEW_HIDDEN_FILTER_HIERARCHY        = AUTOMATIC_PASS
VIEW_JS_SDK_UI_PARITY               = CI_VERIFIED_READY_FOR_ONE_LIVE_UI_RUN
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
- `🎵 RAW_TikTok_Creator_Videos` remains protected/zero-write;
- folder placement under `Setup Phase | Social MKT Data Hub` is complete.

**Never create a new checkpoint. Never rerun controlled Apply after the canonical PASS.**

## Advanced Permission

The four exported Role definitions are inactive/unassigned for this migration scope: zero members and zero Dashboard Role assignments. They are not materialized. Existing Target Roles remain untouched and `base:role:create` is not required.

## View parity ownership

### Closed Server OpenAPI dimensions

- hidden fields — automatic PASS;
- supported filters — automatic PASS;
- hierarchy — documented write/readback PASS.

The Base JS SDK runner treats hidden state as verify-only and does not rewrite hidden/filter/hierarchy through a second path.

### Base JS SDK UI-owned dimensions

The runner may reconcile only documented frontend-plugin View capabilities:

- sort: 41 Views;
- group: 4 Views;
- explicit column width: 70 Views / 898 assignments;
- row height: 110 Views, all level 1.

Implementation:

- `scripts/lib/lark-base-view-js-sdk-parity.js` — names-only execution plan and refresh-compatible Source admission;
- `scripts/customer-base-view-ui-parity-server.mjs` — checkpoint fence, Source discovery/admission and localhost runner;
- `scripts/customer-base-view-ui-parity.browser.js` — exact Target preflight + supported SDK mutation/readback;
- `tests/scripts/lark-base-view-js-sdk-parity.test.js` — UI-plan and Source-admission regressions;
- `docs/project-brain/customer-base-view-js-sdk-ui-parity-2026-08-21.md` — ownership/safety evidence.

The browser pins `@lark-base-open/js-sdk@1.0.2` and uses only documented frontend plugin methods.

### Source resolver recovery

The first live-start shell stopped before the runner because it hard-required historical current Source SHA:

`1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`

That shell-level exact-SHA gate is retired for View UI closure. The runner now owns Source discovery/admission:

1. verify the immutable original checkpoint SHA and baseline authority;
2. search Desktop and Downloads for `Social MKT Data Hub*.base`, unless an explicit Source path is supplied;
3. require the same refresh-compatible structural boundary as controlled Apply:
   - Tables 33;
   - Fields 723;
   - Views 111;
   - Relations 12;
   - Formulas 4;
   - Dashboards 6;
   - Workflows 2;
   - Advanced Permission roles 4;
   - Records >= 35,528;
4. exclude protected TikTok and require exact checkpoint clone-scope Table-name set;
5. require exact retained View UI plan counts 32 Tables / 110 Views / sort 41 / group 4 / widths 898 / row-height 110;
6. if multiple admitted exports have different View UI plan fingerprints, stop before Lark mutation;
7. otherwise use the newest admitted Source export.

The runner no longer requires one historical refresh SHA merely to start UI parity.

### Full preflight before first UI mutation

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

Only `⚙️ MKT_Report_Settings` has multiple Source field-order templates across its Views. Every other clone Table has one Source order template shared by its Views, although Lark stores layout per View.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never rerun controlled automatic Apply.
3. Never delete/recreate migration-owned Tables/Fields/Records.
4. Never mutate Source, Worker, D1, Queue, schedule or deployment for this workstream.
5. Never retry legacy Formula presentation PUT.
6. Never rewrite hidden/filter/hierarchy from the JS SDK runner; hidden is verification-only there.
7. Never guess an undocumented payload/setter for field order, frozen columns, Dashboard or Workflow.
8. Never create inactive exported Advanced Permission Roles.
9. PR #661 stays Draft/Open/Unmerged until all UI/manual gates and final export verification close.

## Required closure sequence

1. Require full Branch Verification SUCCESS on the final runner/docs HEAD.
2. Start the localhost runner; Source discovery/admission is performed by the runner itself.
3. Add/open `http://127.0.0.1:4173` as a Base extension script inside the exact customer Target Base.
4. Run supported View UI parity once and retain only its compact summary JSON.
5. Use the reported field-order mismatch count to finish only actual remaining field-order work; frozen columns remain manual.
6. Complete Formula presentation 4 and dynamic-date filter 1.
7. Recreate/verify Dashboards 6 / 75 charts and Workflows 2 through supported UI/source reference.
8. Export Target once and verify all manual-owned View dimensions locally.
9. Ready/Merge PR #661 only after every gate closes and only on explicit user instruction.

## Implementation result

Refresh-compatible View UI Source resolver + runner milestone:

```text
HEAD                          2d24ed774871a8964ffacaf2a3179458ef03fd07
Branch Verification Run       32439800301
Job                           96648064895
Result                        SUCCESS
```

Passed:

- locked dependency install;
- syntax / architecture / repository hygiene;
- focused Report / Meta / Woo / Chatwoot / TikTok suites;
- full Unit + Workers runtime including refresh-compatible Source regression;
- Report reliability regression;
- dependency audit;
- Wrangler dry-run;
- diff whitespace and diagnostics/post steps.

This documentation closeout changes no runtime behavior. The resulting documentation HEAD must receive Branch Verification SUCCESS before live UI execution.
