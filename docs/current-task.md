# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = AUTOMATIC_CANONICAL_PARITY_PASS_UI_CLOSURE
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_PARITY_TABLES                 = 32
CLONE_PARITY_VIEWS                  = 110
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = PREPARED_AND_MUST_BE_REUSED
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7
CURRENT_SOURCE_PATH                 = /Users/wasanjantawong/Desktop/Social MKT Data Hub.base
AUTOMATIC_CANONICAL_VERIFY          = PASS_MISMATCH_COUNT_0
AUTOMATIC_APPLY                     = CLOSED_DO_NOT_RERUN
FORMULA_DEFINITION                  = AUTOMATIC_PASS
FORMULA_PRESENTATION                = MANUAL_UI_4
VIEW_HIDDEN_FILTER_HIERARCHY        = AUTOMATIC_PASS
VIEW_JS_SDK_UI_PARITY               = IMPLEMENTED_PENDING_LIVE_UI_RUN
VIEW_FIELD_ORDER                    = MANUAL_AUDIT_110_VIEWS
VIEW_FROZEN_COLUMNS                 = MANUAL_110_VIEWS
DYNAMIC_DATE_VIEW_FILTER            = MANUAL_UI_1
DASHBOARDS                          = MANUAL_UI_6_75_CHARTS
WORKFLOWS                           = MANUAL_UI_2
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_UI_PARITY_AND_FINAL_EXPORT
```

## Objective

Close the remaining functional/UI parity of the approved `Social MKT Data Hub` migration inside customer Base `✨Marketing Content Calendar` without reopening the already-completed automatic migration or touching pre-existing customer resources.

## Automatic migration — closed

The final GET-only canonical verifier returned:

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

This closes automatic Table / Field / Record / Relation / Formula-definition / supported View parity. There is no remaining reason to run `customer-base-controlled-apply.mjs --apply` again.

### Immutable safety baseline

- checkpoint: `$HOME/Downloads/customer-base-controlled-apply-checkpoint.json`;
- checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`;
- checkpoint Source baseline SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`;
- current Source SHA-256: `1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`;
- `🎵 RAW_TikTok_Creator_Videos` remains immutable/protected and outside clone traversal;
- folder placement under `Setup Phase | Social MKT Data Hub` is already complete by the user.

**Never run `--prepare-checkpoint` again. Never rerun controlled Apply after the canonical PASS.**

## Advanced Permission

The exported four Role definitions are inactive/unassigned for this migration scope. They have zero members and zero Dashboard Role assignments. Controlled Apply now skips inactive Role definitions and does not require `base:role:create`. Existing Target roles remain untouched.

## View ownership after automatic PASS

### Server OpenAPI automatic-owned — closed

- hidden fields: canonical PASS;
- filters: canonical PASS except one intentionally unsupported dynamic-date token requirement;
- hierarchy: documented write/readback PASS.

These dimensions must not be replayed through another write path. The Base JS SDK UI runner verifies hidden state but does not rewrite it, and leaves filter/hierarchy untouched.

### Base JS SDK UI-owned

The earlier View manifest classified all non-OpenAPI layout properties as manual. Current Base frontend plugin SDK exposes documented mutation APIs for a subset of those properties, so the closure path is refined without guessing Server OpenAPI payloads.

The UI runner may change only:

- sort — Source represents 41 Views;
- group — Source represents 4 Views;
- explicit non-null column width — 70 Views / 898 assignments;
- row height — 110 Views, all level 1.

Runner files:

- `scripts/lib/lark-base-view-js-sdk-parity.js`;
- `scripts/customer-base-view-ui-parity-server.mjs`;
- `scripts/customer-base-view-ui-parity.browser.js`;
- regression: `tests/scripts/lark-base-view-js-sdk-parity.test.js`.

The local server accepts only current Source SHA `1571cef...`, exact structural counts and exact retained View-plan counts before it serves the plugin UI.

The browser-side runner performs complete preflight before any mutation:

1. current Base must be editable;
2. all four Target identity anchors must exist;
3. all 32 exact clone Table names must exist;
4. all 110 exact Views and every referenced Field must exist;
5. hidden-field membership must still equal the already-passed automatic state;
6. every required documented Base JS SDK method must be present.

Only after the entire preflight passes may it reconcile supported View UI settings. It never calls Record, Field-schema, Formula, Filter, hierarchy, Role, Table-create/delete or View-create/delete mutations.

### Still manual after the SDK runner

No documented Base JS SDK setter is authorized for:

- field/column order — 110 Views; `getFieldMetaList()` is used for exact ordered audit;
- frozen-column count — 110 Views.

Only `⚙️ MKT_Report_Settings` has multiple Source field-order templates across its Views; other clone Tables use one Source order template per Table even though the UI setting is per View.

## Other UI-only closure

- Formula presentation: 4 fields;
- unsupported dynamic-date filter: 1 View (`TheLastMonth` semantics remain UI-owned);
- Dashboards: 6 / 75 charts;
- Workflows: 2;
- final Target `.base` export and local manual-owned parity verification.

Dashboard/Workflow raw opaque payloads remain non-replayable. Use the retained safe UI/source-reference procedure in `docs/project-brain/customer-base-dashboard-workflow-manual-parity-2026-08-19.md`.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never rerun controlled automatic Apply after the final canonical PASS.
3. Never delete/recreate migration-owned Tables, Fields or Records.
4. Never mutate Source.
5. Never mutate Worker, D1, Queue, schedule or deployment state for this workstream.
6. Never retry legacy Formula presentation PUT.
7. Never replay hidden/filter/hierarchy through the UI runner; hidden is verify-only there.
8. Never guess a Server OpenAPI payload for View field order, widths, row height, frozen columns, Dashboard or Workflow.
9. Never create inactive exported Advanced Permission Roles.
10. PR #661 remains Draft/Open/Unmerged until all UI/manual gates and final export verification close.

## Required closure sequence

1. Branch Verification must pass on the exact final UI-runner HEAD.
2. Run the localhost Base JS SDK UI runner against the exact current Source authority.
3. Open that localhost extension inside the exact customer Target Base and run supported View UI parity once.
4. Require compact runner summary to show supported View UI PASS; retain exact field-order mismatch count.
5. Complete only the remaining field-order/frozen-column manual dimensions identified by the runner.
6. Complete Formula presentation 4 and dynamic-date filter 1.
7. Recreate/verify Dashboards 6 / 75 charts and Workflows 2 through supported UI/source reference.
8. Export Target once and verify manual-owned View dimensions locally.
9. Ready/Merge PR #661 only after every gate is closed and only with explicit user instruction.

## Implementation result

Implementation in progress on `work/customer-base-consolidation-v1`:

- added names-only Base JS SDK View parity-plan projection;
- added fail-closed plan regressions for direction, explicit widths and row-height bounds;
- added localhost Source-authority/plan-count gated server;
- added browser-side exact Target preflight and supported View UI reconciliation;
- browser output ends with compact `=== COPY THIS SUMMARY JSON ===` block;
- documentation records the refined Server OpenAPI vs Base JS SDK ownership boundary.

Final exact HEAD and Branch Verification run/job are pending. Do not execute the UI runner until this section records full CI SUCCESS.
