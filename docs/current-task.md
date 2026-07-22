# Current Task — Ads Schema DEV Closeout v0.13.0

## Status

- **Task status:** `closed_schema_views_and_formulas_dev_verified`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Merged implementation:** `PR #10`
- **Merged baseline:** `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`
- **Live Lark mutation:** `completed_and_verified`
- **Meta schema:** `apply_pass_zero_drift_pass`
- **Canonical Ads v2 migration:** `pass_zero_drift_pass`
- **Google Ads automated schema:** `pass_zero_drift_pass`
- **Manual Lark UI:** `4_formulas_live_verified_view_filters_19_of_19_complete`
- **Connector implementation:** `not_started`
- **Google Ads access preflight:** `manager_script_read_only_uat_pass`
- **Google Ads Manager Script UAT:** `pass_data_available_6_of_6_zero_changes`
- **Google Ads direct API UAT:** `deferred_optional_for_mvp`
- **Cloudflare/Queue/D1/Schedule:** `unchanged_for_this_task`
- **Production mutation:** `none`
- **Last updated:** `2026-07-22`

งาน Guarded Shared-table Apply, Ads/Google Ads Schema, View filters และ Formula fields ถูก Apply ลง Lark DEV จริงแล้ว. Schema/Views/Formula ตรวจด้วย Live readback และ fresh configuration-only `.base` ครบแล้ว; งานถัดไปเป็น Connector/Access scope แยกต่างหาก.

## Objective completed

ปิด Data-model-first และ Lark Schema foundation สำหรับ Organic/Ads แบบ Shared-table โดย:

- รักษา `RAW_TikTok_Creator_Videos` เป็น Lark Native protected read-only source;
- Reuse Planned Raw tables ตาม Shared-table contract โดยไม่ลบ Record;
- Apply Meta Ads extensions และ Canonical Ads v2 แบบไม่สร้าง Canonical core ซ้ำ;
- เพิ่ม Google Ads RAW/Canonical extensions, Relations และ View shells;
- รองรับ Partial resume และตรวจ Zero drift หลัง Apply;
- ไม่เขียน Business Record, ไม่เรียก Platform source API, ไม่ Deploy Worker และไม่เปิด Schedule ในงาน Schema นี้.

## Verified live result

Latest audited configuration-only export: `Social MKT Data Hub.base`

- SHA-256: `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8`
- Physical tables: `42`
- Duplicate table names: `0`
- Google RAW tables: `13/13`
- Google RAW fields: `208/208`
- `MKT_Ads_AssetGroups`: `PASS`
- Canonical Ads v2 core: `63/63`
- Google Ads Relations: `12/12`
- Google Ads View shells: `19/19`
- Automated schema issues: `0`
- New Google tables containing Records: `0`
- Remaining schema actions: `0`
- Remaining View-shell actions: `0`
- Blockers/warnings: `0/0`
- Record writes/deletes: `0/0`

## Manual UI result

OpenAPI-supported schema work, all 19 Google View filters and Formula UI work are complete in Live DEV. Formula contract เดิมใช้ `{field}` และ `BLANK()` ซึ่ง Live tenant ปฏิเสธ; final contract ด้านล่างใช้ official `[field]` reference และ `ISBLANK(...)` ที่ผ่าน Formula editor validation จริง.

### Formula expressions — 4/4 Live verified

1. `MKT_Ads_Campaigns.budget`
   - `IF(ISBLANK([budget_micros]),"",[budget_micros]/1000000)`
   - format `0.00`
2. `MKT_Ads_Daily.all_conversion_value`
   - `IF(ISBLANK([all_conversion_value_micros]),"",[all_conversion_value_micros]/1000000)`
   - format `0.00`
3. `MKT_Ads_Daily.cost_per_conversion`
   - `IF(OR(ISBLANK([conversions]),[conversions]=0,ISBLANK([spend])),"",[spend]/[conversions])`
   - format `0.00`
4. `MKT_Ads_Daily.conversion_rate`
   - `IF(OR(ISBLANK([clicks]),[clicks]=0,ISBLANK([conversions])),"",[conversions]/[clicks])`
   - format `0.00%`

Live readback reopened all four Field editors and matched Formula type, exact normalized expression and number format `4/4`. Lark showed `Saved to cloud`. Fresh configuration-only export SHA-256 `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8` subsequently passed offline serialization: Formula/type/formatter `4/4`, 42 tables, 737 fields, 133 Views and Filter/Sort/Hidden drift `0/0/0`.

### View filters

- Contract View shells exist `19/19`.
- Filters verified Live after the v0.13.5 Apply: `19/19`.
- Guarded Apply updated `17` Views, created `0` Views and finished with zero actions/conflicts/warnings.
- `Google Ads Daily 30D` also has the UI-owned condition `metric_date is in the past 30 days`; Live Get View returns its canonical response token as `TheLastMonth`.
- Full Live audit after Apply: 42 tables, 133 Views, 42 filtered Views, 7 Views with hidden fields and 133/133 identity match against the pre-Apply export.
- The only 17 Filter differences from that export are the exact expected Google actions; hidden-field differences are `0`.
- Fresh configuration-only export SHA-256 `704c10ea6fb1cd0790949cbc94a0865398521f00f7695a4f8ef5e8aa3c4c3ef2` passed the final offline serialization audit: 42 tables, 133 Views, Filter/Sort/Hidden drift `0/0/0`, missing/unexpected Views `0/0` and prior Google changes matched `17/17`.
- The fresh export confirms `Google Ads Daily 30D` as `platform is google_ads AND metric_date is TheLastMonth`; no rerun of Apply is required.

The Full View Contract v0.13.5 and Formula UI handoff are closed and verified for DEV. Do not rerun View or Formula Apply.

## Live apply history

- PR #10 was Squash Merged into `main` at commit `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`.
- Meta schema Apply passed and returned zero drift.
- Canonical Ads v2 migration passed and returned `63/63` zero drift.
- Google Ads executor resumed safely across partial stages.
- Final executor version: `0.13.0-rc5.1`.
- Final automated status: `SCHEMA_APPLY_MANUAL_UI_REQUIRED`.
- All 16 missing Google Ads View shells were created; final verification returned `viewActions=0`.
- No rollback or destructive cleanup is required.

## Scope explicitly not completed here

- Google Ads data extraction/normalization connector;
- Google Ads signed delivery connector, destination writes and operational rollout;
- TikTok Ads connector or production access;
- Facebook/Instagram Organic connectors despite completed access preflight;
- Meta Ads data connector despite valid no-data access preflight;
- WooCommerce and Chatwoot connectors;
- Multi-channel AI summary/notification completion;
- customer-real UAT rollout and customer-owned Production deployment.

## Progress model

Percentages are milestone estimates, not code coverage:

- Ads/Google Lark data model and presentation: `100%` — Formula Live and fresh `.base` offline verification passed.
- Google Ads channel end-to-end: `45%` — schema, link/selectability and Manager Script read-only UAT pass; signed delivery connector, reliability and schedule remain.
- MKT DEV MVP across all planned channels: approximately `59%`.
- Chemistry K Production readiness: approximately `25%` because customer-owned UAT/Production rollout and several connectors remain.

Detailed channel percentages and weighting are recorded in `docs/project-brain/mkt-progress-v0.13.0.md`.

## Next gate

1. Approve a separate Google Ads Manager Script delivery task before adding a Worker endpoint, Queue/D1 state or Lark writes.
2. Lock the signed payload, replay/idempotency, bounded batch, retention and redaction contracts before enabling external delivery.
3. Run a manual isolated UAT through the signed endpoint with Connector/Schedule disabled, then verify reconciliation and idempotent rerun.
4. Keep direct Google Ads API Basic/Explorer Access as an optional Phase 2 path for scale or fields unavailable to Scripts; it does not block the Manager Script MVP.
5. Keep every new connector and Production schedule disabled by default until its own access, identity, source-contract and reliability gates pass.

## Definition of done for this closed task

- [x] PR #10 merged.
- [x] Shared-table guarded Apply executed in developer-owned DEV.
- [x] Meta schema Apply and zero-drift verification passed.
- [x] Canonical Ads v2 migration and `63/63` verification passed.
- [x] Google Ads 13 RAW tables / 208 fields / 12 Relations / 19 View shells verified.
- [x] Zero destructive actions and zero Business Record writes verified.
- [x] Latest `.base` export audited with zero schema issues.
- [x] Formula UI work completed and verified by exact Live editor readback `4/4`.
- [x] Fresh post-Formula `.base` offline serialization proof passed Formula/type/formatter `4/4` with zero View drift.
- [x] Modular Project Brain progress baseline prepared.

## Implementation result — Google Ads Manager Script read-only UAT 2026-07-22

- Signed-in Google Ads UI access to the developer-owned manager succeeded without changing account, campaign, billing or API settings.
- After customer authorization, the manager account table exposed the approved Chemistry K advertiser as `Enabled` under the intended direct manager. Opening the account loaded its Overview and existing production history, so link, exact UI identity and selectability passed.
- API Center showed the developer token at `Test Account Access`; no application or access-level change was submitted. This blocks the direct API path but does not block Google Ads Manager Scripts running under the authorized manager.
- No `GOOGLE_ADS_*` OAuth/developer-token/login-customer/customer configuration keys were present in the checked local runtime/config key names. Secret values were not viewed, copied or logged.
- The existing 598-line Manager Script was safety-scanned before execution. It uses `AdsManagerApp` plus `AdsApp.search()` GAQL and logging; no external delivery, Spreadsheet/Mail, Ads mutation, budget, pause/enable/remove or campaign-builder path was found.
- The target allowlist was changed from the obsolete DEV setup account to the customer-authorized Chemistry K account; only that allowlist and safety comments were changed before Preview.
- First Preview failed closed as `partial_error` because this Google Ads Scripts runtime rejected `campaign.start_date` and `campaign.end_date`. Those two query fields were removed while their mappers remain nullable, preserving `null` semantics instead of fabricating values.
- Final Preview returned `data_available`: all six datasets succeeded, all were non-empty, dataset errors/truncation were `0/0`, sample rows stayed within the configured cap, and the Changes tab showed `No changes`.
- Script management readback showed Frequency `—` (no schedule) and `Finished with no changes`; no automatic execution was enabled.
- Direct `ListAccessibleCustomers` was not called and direct API Basic Access remains deferred. Manager Script GAQL read-only UAT passed without requiring the direct API developer token.
- Google Ads account/settings mutations, Campaign/Ad/Budget writes, Lark writes, Worker/Queue/D1/Schedule changes, deployment and Production mutations: `0`.
- Connector delivery implementation remains out of scope until a separate signed-endpoint task is approved.
- Final repository gates after the handoff update: `npm run check` pass (Architecture `147/348/0`), Unit `536/536`, Workers runtime `9/9`, Report reliability `70/70`, offline audit `0` and deploy dry-run `659.26/130.46 KiB` pass. No deployment occurred.

## Implementation result — Formula UI Live closeout v0.13.6

- Live target: developer-owned DEV / `dev_ft_pumkin`.
- Field mutations: Formula expression and number format only for the four approved fields; Table/View/Record mutations `0`.
- Confirmed Live syntax correction: `{field}` → `[field]`; `BLANK()` → `ISBLANK(...)` with `""` as the blank result.
- Formula editor validation passed before each save; final exact expression/format readback passed `4/4` and Lark showed `Saved to cloud`.
- No Connector, source API, Worker, Queue, D1, Schedule, deployment or Production action occurred.
- Fresh post-Formula `.base` SHA-256 `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8`: offline Formula/type/formatter `4/4`; View identity/Filter/Sort/Hidden drift `0/0/0/0`.

## Implementation result — Full View Contract and Google Filters v0.13.5

### Files changed

- Added the 133-View audit and baseline-preservation contract.
- Added an immutable 19-View Google Filter contract, guarded Preview/Apply command and focused tests.
- Hardened the shared View planner to accept an additional UI-owned relative-date condition only when every managed condition remains correct; managed drift with UI-owned conditions now fails closed instead of PATCHing.
- Updated package commands, README, Project Brain and CHANGELOG handoff.

### Live DEV result

- Target: `development / dev_ft_pumkin`.
- Initial Preview: create `0`, update `17`, conflicts/warnings `0/0`.
- Apply: planned/applied `17/17`, created `0`, updated `17`.
- UI: saved `metric_date is in the past 30 days` on `Google Ads Daily 30D`; Lark showed `Saved to cloud`.
- Final managed Preview: create/update/conflicts/warnings `0/0/0/0`.
- Full Live read-only audit: tables `42`, Views `133`, filtered `42`, hidden `7`, identities `133/133`; exactly 17 expected Filter differences from the old export and zero Hidden-field differences.
- Fresh `.base` offline audit: tables `42`, Views `133`, filtered `42`, sorted `6`, hidden `7`; identity/filter/sort/hidden drift `0/0/0/0`, Google changes `17/17`.
- Table/Field/View create, delete or rename: `0`; Business Record reads/writes: `0`; Connector/Worker/Queue/D1/Schedule/Production mutation: `0`.

### Verification

- Focused View contract/planner tests: `16/16` pass.
- Node Unit/Integration: `536/536` pass.
- Workers runtime: `9/9` pass.
- Report reliability: `70/70` pass.
- `npm run check`: syntax, Architecture `147/348/0` and Repository hygiene pass.
- `npm audit --offline`: `0` vulnerabilities.
- `npm run deploy:dry-run`: pass at `659.26 KiB / gzip 130.46 KiB`; no deployment occurred.
- Fresh `.base` SHA-256 `704c10ea6fb1cd0790949cbc94a0865398521f00f7695a4f8ef5e8aa3c4c3ef2`; offline serialization audit passed with zero contract drift.
