# Current Task — Ads Schema and Google Ads Read-only UAT Closeout v0.13.7

## Status

- **Task status:** `closed_with_repository_corrections_pending_review`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Merged implementation baseline:** `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- **Correction branch:** `work/repository-closeout-corrections`
- **Live Lark mutation:** `completed_and_verified`
- **Meta schema:** `apply_pass_zero_drift_pass`
- **Canonical Ads v2 migration:** `pass_zero_drift_pass`
- **Google Ads automated schema:** `pass_zero_drift_pass`
- **Manual Lark UI:** `4_formulas_live_verified_google_filters_19_of_19_complete`
- **Managed Lark presentation:** `pass`
- **Legacy specialized View business contracts:** `55_contract_missing_preserved_without_inferred_filters`
- **Google Ads link/selectability:** `pass`
- **Google Ads Manager Script UAT:** `pass_data_available_6_of_6_zero_changes`
- **Google Ads direct API access:** `basic_access_application_submitted_pending_review_current_test_account_access`
- **Google Ads signed delivery connector:** `not_started`
- **Cloudflare/Queue/D1/Schedule for Google Ads:** `not_implemented_disabled`
- **Production mutation:** `none`
- **Last updated:** `2026-07-22`

## Authoritative correction

The Google Ads Basic Access application **was submitted on 2026-07-21** and is pending review.

- Case ID: `1-686800040839`
- Cloud project number: `788131774873`
- Current developer-token level: `Test Account Access`
- Manager Script MVP remains independent from direct API approval.

Any earlier statement that no access application was submitted is superseded by this section.

## Verified Lark result

Latest configuration-only Base state:

- Physical tables: `42`
- Fields: `737`
- Views: `133`
- Duplicate table names: `0`
- Table emoji names: `42/42`
- View emoji names: `133/133`
- Folder placement: `42/42`
- Google RAW tables: `13/13`
- Google RAW fields: `208/208`
- Canonical Ads v2 core: `63/63`
- Google Ads Relations: `12/12`
- Google Ads View shells: `19/19`
- Formula expressions/type/formatter: `4/4`
- Google Ads managed filters: `19/19`
- Shared-table managed filters: `17/17`
- Report managed Views: `6/6`
- Filtered Views total: `42`
- Sorted Views: `6`
- Views with hidden fields: `7`
- New Google tables containing Records: `0`
- Automated schema issues: `0`
- Record writes/deletes during schema closeout: `0/0`

### Formula contract — 4/4

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

`Google Ads Daily 30D` is verified as `platform=google_ads AND metric_date=TheLastMonth`.

## View contract interpretation

The 133 Views are not all business-managed filters:

- Shared-table managed Views: `17`
- Report managed Views: `6`
- Google Ads managed Views: `19`
- All/default Views intentionally unfiltered: `36`
- Legacy specialized Views preserved without inferred business logic: `55`

The current closeout therefore means **managed contract and preservation contract pass**. It does not mean the 55 legacy specialized Views implement business meanings implied by names such as Active, Failed, Latest, Connection Issues or High Spend Low ROAS.

A future business-view task must define exact Table, View, purpose, conjunction, conditions, sort and hidden fields before changing those 55 Views.

## Google Ads read-only UAT

After customer authorization:

- Chemistry K advertiser is enabled under the intended manager and selectable.
- Manager Script target allowlist was updated to the approved advertiser.
- Read-only Script used `AdsManagerApp` and `AdsApp.search()` GAQL.
- Runtime rejected `campaign.start_date` and `campaign.end_date`; those request fields were removed while nullable output fields remain.
- Final Preview returned `data_available`.
- Six bounded datasets succeeded and were non-empty.
- Dataset errors/truncation: `0/0`.
- Google Ads changes: `No changes`.
- Frequency: `—`; no schedule.
- No external delivery, Lark write, Worker route, Queue/D1 path or deployment exists for Google Ads.

The repository currently contains a reproducible evidence manifest, but not the complete sanitized 598-line Script source. The full Script snapshot must be added before a future delivery connector release if independent source-level re-review is required.

## Repository safety correction

The Google Ads View filter command is update-only. The correction branch adds an explicit guard that blocks when the generic planner proposes any `create_view` or other non-`update_view` action.

Required behavior:

- Existing managed Views may receive Filter updates.
- Missing managed Views cause `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`.
- No View creation, deletion or rename is allowed in this task.
- No Field, Table or Business Record operation is allowed.

## RAW error coverage decision

The current 13 Google RAW error Views implement the approved minimum check:

- the table-specific primary raw stable key uses `isEmpty`.

This is an identity-key QA contract, not a comprehensive validation of every supporting field. A separate data-quality task is required if customer ID, entity IDs, status values, report level, segment key or policy state must be checked independently.

## Scope not completed

- Google Ads signed Manager Script delivery endpoint;
- payload version and bounded batch contract;
- HMAC verification, timestamp, nonce and replay protection;
- Google Ads connector catalog entry and feature flag;
- Google Ads Queue job and router;
- D1 nonce/checkpoint/idempotency state;
- six-dataset normalization and destination writers;
- partial-write/retry/reconciliation behavior;
- retention, audit and log redaction;
- isolated customer-real UAT;
- Google Ads schedule activation;
- Production deployment;
- direct Google Ads API authorization/UAT beyond the pending Basic Access application;
- business contracts for 55 legacy specialized Views;
- Meta Ads, TikTok Ads, Facebook/Instagram Organic, WooCommerce and Chatwoot connectors;
- full multi-channel AI summary/notification rollout.

## Progress model

Percentages are milestone estimates, not code coverage:

- Lark data model and managed presentation: `100%`
- Google Ads channel end-to-end: `45%`
- MKT DEV MVP across planned channels: approximately `59%`
- Chemistry K Production readiness: approximately `25%`

## Next gate

1. Merge the repository closeout correction only after focused tests and full gates pass.
2. Open a separate task named `Google Ads Manager Script signed delivery connector`.
3. Lock payload schema, stable/idempotency keys, HMAC/replay, batch limits, null semantics, partial-write behavior, retention and redaction before coding.
4. Implement the connector disabled by default in an isolated DEV/UAT path.
5. Run manual signed-delivery UAT, reconciliation and idempotent rerun with schedule disabled.
6. Enable schedule only after reliability gates pass.
7. Keep Production customer-owned and disabled until channel-specific UAT passes.

## Definition of done for this correction branch

- [x] Correct direct API application history.
- [x] Clarify 133-View contract classes and the 55 missing business contracts.
- [x] Add update-only Google View Filter guard.
- [x] Add focused guard tests.
- [x] Record reproducible Manager Script evidence limitations.
- [x] Record stable-key-only RAW error coverage.
- [ ] Run `npm ci`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:report-reliability`.
- [ ] Run `npm audit --offline`.
- [ ] Run `npm run deploy:dry-run`.
- [ ] Review and merge correction PR.
