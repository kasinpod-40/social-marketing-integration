# Current Task — Guarded Google Ads DEV Schema Apply v0.13.0 RC1

## Status

- **Task status:** `approved_for_implementation`
- **Accepted baseline:** `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`
- **Working branch:** `work/google-ads-schema-apply`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Data model:** approved workbook `Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx`
- **Implementation:** `in_progress`
- **Live Lark mutation:** `blocked_pending_lark_scope_release_and_fresh_authorization`
- **Connector / Worker / Schedule:** `out_of_scope_disabled`
- **Last updated:** `2026-07-22`

## Objective

Implement a fail-closed, resumable and idempotent Schema-only Preview/Apply workflow for the approved Google Ads Blueprint. The workflow must create the 13 Google-specific RAW tables and `MKT_Ads_AssetGroups`, reuse the existing Canonical Ads tables without duplication, add only missing compatible fields/options, create approved relations/views after every Table ID is known, and require live read-back with zero drift.

## In scope

- load the sanitized Google Ads Blueprint contract committed under `docs/google-ads-blueprint-v0.13.0-rc1/`;
- validate exactly 13 RAW tables, 208 RAW fields, one new canonical table and 44 canonical definitions/extensions;
- validate one Primary Text field first in every RAW table and keep all Google Ads identifiers as Text;
- add logical Lark table mappings for the 13 RAW tables and `MKT_Ads_AssetGroups` without committing real Table IDs;
- provide separate read-only Preview and confirmation-gated Apply commands;
- restrict Apply to `MKT_ENV=development` and `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`;
- require a fresh live plan before the first write;
- require the Shared-table Meta Apply to have completed and read back cleanly before Google Apply;
- create only the 13 Google RAW tables and `MKT_Ads_AssetGroups`;
- reuse `MKT_Ads_Accounts`, `MKT_Ads_Campaigns`, `MKT_Ads_AdGroups`, `MKT_Ads_Ads`, `MKT_Ads_Creatives` and `MKT_Ads_Daily`;
- add canonical fields/options only when absent and type-compatible;
- preserve all existing Meta/TikTok select options and never delete an option;
- create relations only after source and target Table IDs exist;
- create table-scoped views and expand the logical cross-table RAW error view into one technical view per Google RAW table;
- expose confirmed partial progress and support safe idempotent rerun;
- run final Schema/View read-back and require zero remaining drift;
- return logical config key → Lark Table ID updates for local ignored configuration.

## Out of scope

- running the live Lark Apply before the new Lark permission version is active and the user gives a new exact authorization;
- Google Ads connector, Manager Script changes, Worker endpoint, Queue job, D1 migration or schedule activation;
- Google Ads API/GAQL calls or Live data UAT;
- creating, activating or spending on advertisements;
- writing/updating/deleting Business records;
- deleting/renaming existing Canonical tables or fields;
- changing an existing field type automatically;
- changing `RAW_TikTok_Creator_Videos` or any other protected external source;
- UAT or Production mutation;
- committing credentials, developer token, OAuth secret/token, password, authorization header, billing data or real Lark Table IDs.

## Locked data contract

1. Google-specific RAW tables remain separate from `RAW_Ads_Entities` and `RAW_Ads_Daily`: the former preserve exact resource/query contracts; the latter remain normalized shared adapter outputs.
2. Ad, reusable Asset/Creative and Performance Max Asset Group are separate entities.
3. Ad ↔ Asset is many-to-many through `RAW_Google_Ads_Ad_Assets` and Canonical `creative_links`.
4. Performance Max Asset Group must never be normalized as Ad Group.
5. Money source of truth is integer micros; divide by 1,000,000 only in display/normalization fields.
6. Daily date uses `segments.date` in the Google Ads account timezone.
7. Explicit source zero remains zero; only unsupported/unreturned fields are null.
8. `segment_key != all` remains RAW-only for Canonical V1.
9. Conversions and All conversions stay separate.
10. Conversion Actions remain separate until an approved conversion set exists.
11. `RAW_Google_Ads_Account_Links.link_status` is resolved as `SingleSelect` because the approved option set is controlled.
12. Blank-aware formulas must preserve explicit zero.
13. `google_other_ads` versus existing `google_other` is a blocking semantic decision; the Apply must not add both blindly.
14. The five additional `MKT_Ads_Daily` relation field names not explicitly listed in `03_Canonical_Extensions` remain blocked until approved; `asset_group_link` may proceed when compatible.

## Locked execution contract

1. `npm run setup:google-ads-schema` is always read-only.
2. Apply requires the dedicated `:apply` command plus `CONFIRM_WRITE=YES` and `CONFIRM_GOOGLE_ADS_SCHEMA=YES` in the same invocation.
3. Apply must fail before constructing a write plan outside exact developer-owned DEV.
4. A fresh Preview must have zero conflicts, warnings and unresolved blocking decisions before the first write.
5. Meta/shared-table dependency tables must resolve by live Table ID and the Canonical core compatibility gate must pass.
6. The Apply must not contain rename, delete, record-write or field-type mutation actions.
7. Schema writes run sequentially; confirmed progress is included in any failure.
8. Rerun reconciles create operations by exact table/field/view identity and must not duplicate resources.
9. Relations are deferred until every referenced Table ID exists.
10. Final Schema and View read-back must report zero actions, conflicts, warnings and blocking manual decisions.
11. Real Table IDs are returned only as operator output for ignored `.dev.vars` / `wrangler.sync.jsonc`.
12. Connector, Worker endpoint and every Google Ads business schedule remain disabled after successful Schema Apply.

## Acceptance criteria

1. Contract validation proves 13 RAW tables, 208 RAW fields, one new Canonical Asset Group table and 44 Canonical definitions/extensions.
2. Every RAW table has exactly one Primary Text field first; every Google Ads ID field is Text.
3. Preview cannot write even when confirmation variables remain in the shell.
4. Apply fails unless both confirmations and `--apply` are present.
5. DEV/profile guard rejects UAT and Production before any write-capable client action.
6. No `create_table` action targets the six existing Canonical Ads tables.
7. Existing Canonical fields are skipped when type-compatible and block when type-incompatible; no automatic rename/type change occurs.
8. Select options merge additively and retain all existing option IDs/values.
9. Relations resolve source/target live Table IDs and preserve Ad↔Creative many-to-many semantics.
10. Logical RAW errors view becomes 13 table-scoped technical views.
11. Partial failure reports exact confirmed actions and rerun completes without duplicates.
12. Successful rerun performs zero writes and final verification is zero drift.
13. Protected source actions, delete actions and Business-record writes remain zero.
14. Full Unit/Integration, Workers-runtime, Report reliability, architecture, hygiene, audit and Wrangler dry-run gates pass.

## Required commands

```bash
npm ci
npm run check
node --test \
  tests/config/google-ads-lark-schema.test.js \
  tests/config/google-ads-schema-runtime-config.test.js \
  tests/application/preview-google-ads-lark-schema.test.js \
  tests/application/apply-google-ads-lark-schema.test.js \
  tests/scripts/google-ads-schema-installer-mode.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Operator commands after merge, active Lark permission and a new exact authorization:

```bash
npm run setup:shared-table-schema
CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply
npm run setup:shared-table-schema

npm run setup:google-ads-schema
CONFIRM_WRITE=YES CONFIRM_GOOGLE_ADS_SCHEMA=YES npm run setup:google-ads-schema:apply
npm run setup:google-ads-schema
```

## Implementation result

- **Implementation status:** `IN_PROGRESS`
- **Live Lark Apply:** not run
- **Business Record writes:** none
- **Google Ads API / GAQL:** not called
- **Cloudflare / Queue / D1 / Schedule:** unchanged
- **Production mutation:** none

## Next gate

Complete implementation and focused/full tests on this branch, open a Draft PR into `main`, and perform an independent diff/CI review. Live Meta and Google Schema Apply remain separate later actions requiring fresh previews and exact user authorization.