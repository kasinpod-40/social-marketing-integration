# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = AUTOMATIC_PASS_VIEW_UI_SAME_ORIGIN_SDK_RECOVERY
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
VIEW_JS_SDK_UI_PARITY               = SAME_ORIGIN_SDK_RECOVERY_PENDING_BRANCH_VERIFICATION
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

## Local Base extension transport and SDK bootstrap recovery

The first live runner started successfully on `127.0.0.1:4173`, but Lark's extension side panel remained on `Loading…`; the runner UI itself never rendered, so no Base JS SDK preflight or mutation began.

A LAN-bound recovery then proved transport reachability: the Lark extension caused the Mac runner to receive `GET /` and `GET /app.js` on the emitted `192.168.x.x:4173` address. The panel still remained on `Loading…`, which isolates the remaining blocker to browser-side SDK bootstrap rather than host/IP reachability.

The official Lark HTML template imports `@lark-base-open/js-sdk` as a build dependency and bundles it into the plugin. The previous runner instead imported `https://esm.sh/@lark-base-open/js-sdk@1.0.2` directly inside the Lark iframe. The recovery now removes that cross-origin runtime dependency from the browser:

- SDK version remains pinned to `@lark-base-open/js-sdk 1.0.2`;
- before `server.listen()` and before any `READY` status, the Mac runner fetches the pinned `esm.sh` standalone build server-side;
- root-relative `esm.sh` module stubs are resolved server-side, with a hard hop limit and origin fence;
- unresolved browser module dependencies, non-success fetches, undersized bundles, or bundles without the `bitable` export shape fail closed before the runner starts;
- the resolved SDK body is held in memory and served locally as `/lark-base-js-sdk.mjs`;
- the browser imports only `/lark-base-js-sdk.mjs`, so the Base iframe does not need to reach `esm.sh` at runtime;
- READY/health expose `sdkDeliveryMode=same-origin-pinned-standalone`, exact SDK version, SHA-256 and byte count;
- `client-event?stage=html-executed` proves the iframe executed the served HTML;
- `client-event?stage=browser-module-loaded` occurs only after the same-origin SDK module imported successfully;
- neither boot marker calls a Base API, so Target reads/writes still do not begin before the user clicks the runner button;
- Target mutation remains impossible until the extension UI loads and the user explicitly clicks the runner button, after which the existing full preflight still runs first.

LAN transport safety remains:

- default host remains `127.0.0.1` for standalone/local inspection;
- live Lark extension recovery binds only to the Mac's current LAN IPv4 via `CUSTOMER_BASE_VIEW_UI_HOST`;
- the same address is emitted through `CUSTOMER_BASE_VIEW_UI_PUBLIC_HOST` as the URL to paste into Lark;
- CORS is reflected only for HTTPS `*.larksuite.com` / `*.feishu.cn` origins;
- only `GET`, `HEAD`, and `OPTIONS` are exposed;
- every incoming request is logged as `[view-ui-local] ...`.

## Operators

- `scripts/lib/lark-base-view-js-sdk-parity.js` — names-only plan projection, structural admission and exact layout-revision authority;
- `scripts/customer-base-view-ui-parity-server.mjs` — checkpoint fence, Source discovery/admission, LAN transport, pinned SDK localization and localhost runner;
- `scripts/customer-base-view-ui-parity.browser.js` — same-origin SDK bootstrap, exact Target preflight + supported SDK mutation/readback;
- `scripts/customer-base-view-ui-source-diagnostic.mjs` — local read-only Source/layout diagnostic using the same authority function;
- `tests/scripts/lark-base-view-js-sdk-parity.test.js` — normalization, structural admission and exact 42-sort inventory regressions;
- `tests/scripts/customer-base-view-ui-parity-delivery.test.js` — same-origin SDK delivery and pre-READY localization regression.

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
2. Resolve the Mac's LAN IPv4 and start `scripts/customer-base-view-ui-parity-server.mjs` with that address as both bind/public host; require `status=READY`, exact Source SHA `9c24...`, `sourcePlanAuthorityMode=exact-refresh-layout-revision-facebook-content-published-at-desc`, `sortViews=42`, `sdkDeliveryMode=same-origin-pinned-standalone`, `sdkVersion=1.0.2`, and non-empty SDK SHA/byte evidence.
3. Reopen the existing Base extension script inside the exact customer Target Base using the emitted LAN URL; the URL need not change if the Mac LAN IP is unchanged.
4. Before clicking anything, require Terminal evidence for `/client-event?stage=html-executed`, `/app.js`, `/lark-base-js-sdk.mjs`, and `/client-event?stage=browser-module-loaded`, and require the runner UI to render inside Lark.
5. Run supported View UI parity once and retain its compact summary JSON.
6. Use the reported field-order mismatch count to finish only actual remaining field-order work; frozen columns remain manual.
7. Complete Formula presentation 4 and dynamic-date filter 1.
8. Recreate/verify Dashboards 6 / 75 charts and Workflows 2 through supported UI/source reference.
9. Export Target once and verify all manual-owned View dimensions locally.
10. Ready/Merge PR #661 only after every gate closes and only on explicit user instruction.
