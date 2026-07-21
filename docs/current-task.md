# Current Task — Guarded Google Ads DEV Schema Apply v0.13.0 RC1

## Status

- **Task status:** `implemented_draft_pr_ci_pass`
- **Accepted baseline:** `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`
- **Working branch:** `work/google-ads-schema-apply`
- **Draft Pull Request:** `#11`
- **Verified head:** `7e84005b29b430073774b24539e4908b37cbf365`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Data model:** approved workbook `Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx`
- **Implementation:** `complete_source_only`
- **Live Lark mutation:** `blocked_pending_lark_scope_release_meta_zero_drift_decisions_and_fresh_authorization`
- **Connector / Worker / Schedule:** `out_of_scope_disabled`
- **Last updated:** `2026-07-22`

## Objective

Implement a fail-closed, resumable and idempotent Schema-only Preview/Apply workflow for the approved Google Ads Blueprint. The workflow creates the 13 Google-specific RAW tables and `MKT_Ads_AssetGroups`, reuses the existing Canonical Ads tables without duplication, adds only missing compatible fields/options, creates approved Relations/Views after every Table ID is known, and requires final live read-back with zero drift.

## Implemented scope

- sanitized Google Ads schema metadata derived from the approved workbook;
- exact validation of 13 RAW tables, 208 RAW fields, one new Canonical table and 44 Canonical definitions/extensions;
- one Primary Text field first in every RAW table and Text enforcement for Google Ads IDs;
- logical Lark table mappings for all 13 RAW tables and `MKT_Ads_AssetGroups`, with placeholders only;
- separate always-read-only Preview and exact-confirmation guarded Apply commands;
- DEV/profile fail-closed guard for `development` + `dev_ft_pumkin` only;
- fresh live Preview before the first write;
- Meta/shared dependency gate requiring the final shared table names and rejecting the five legacy pre-Meta names;
- Canonical Ads v2 compatibility gate for 63 required core fields without creating, renaming or type-mutating the core;
- creation restricted to the 13 Google RAW tables and `MKT_Ads_AssetGroups`;
- reuse of `MKT_Ads_Accounts`, `MKT_Ads_Campaigns`, `MKT_Ads_AdGroups`, `MKT_Ads_Ads`, `MKT_Ads_Creatives` and `MKT_Ads_Daily`;
- add-only compatible Canonical extensions and Select options while retaining existing option IDs/values;
- explicit blocking decision for `google_other_ads` when shared `google_other` already exists;
- seven declared Link fields, including many-to-many `creative_links`, created only after source/target Table IDs resolve;
- 19 physical Views: six workbook Views plus 13 table-scoped `Google Ads RAW Errors` Views;
- sequential writes, typed partial-progress errors and idempotent rerun recovery;
- final Schema/Relation/View read-back requiring zero remaining drift;
- logical config key → live Lark Table ID output for ignored local config;
- non-blocking Lark UI review for the rolling Last-30-days date filter;
- project-brain design record at `docs/project-brain/google-ads-schema-apply-v0.13.0-rc1.md`.

## Out of scope and unchanged

- live Lark Apply before the new Lark permission version is active and the user gives a new exact authorization;
- Google Ads connector, Manager Script changes, Worker endpoint, Queue job, D1 migration or Schedule activation;
- Google Ads API/GAQL calls or Live data UAT;
- creating, activating or spending on advertisements;
- reading/writing/updating/deleting Business records;
- deleting/renaming existing Canonical tables or fields;
- changing an existing field type automatically;
- changing `RAW_TikTok_Creator_Videos` or another protected external source;
- UAT or Production mutation;
- committing credentials, developer token, OAuth secret/token, password, authorization header, billing data or real Lark Table IDs.

## Locked data contract

1. Google-specific RAW tables remain separate from `RAW_Ads_Entities` and `RAW_Ads_Daily`: the former preserve exact resource/query contracts; the latter remain normalized shared adapter outputs.
2. Ad, reusable Asset/Creative and Performance Max Asset Group are separate entities.
3. Ad ↔ Asset is many-to-many through `RAW_Google_Ads_Ad_Assets` and Canonical `creative_links`.
4. Performance Max Asset Group must never be normalized as Ad Group.
5. Money source of truth is integer micros; divide by 1,000,000 only in display/normalization.
6. Daily date uses `segments.date` in the Google Ads account timezone.
7. Explicit source zero remains zero; only unsupported/unreturned fields are null.
8. `segment_key != all` remains RAW-only for Canonical V1.
9. Conversions and All conversions stay separate.
10. Conversion Actions remain separate until an approved conversion set exists.
11. `RAW_Google_Ads_Account_Links.link_status` is `SingleSelect` because the approved option set is controlled.
12. Formula expressions remain metadata hints in this Schema task; future calculation must be blank-aware and preserve explicit zero.
13. `google_other_ads` versus existing `google_other` is a blocking semantic decision; Apply does not add both blindly.
14. Only the seven physical Link fields explicitly declared in `03_Canonical_Extensions` are created; undeclared `MKT_Ads_Daily` Link names are not invented.
15. The logical cross-table RAW error View is implemented as 13 table-scoped physical Views.

## Locked execution contract

1. `npm run setup:google-ads-schema` is always read-only, even when confirmation variables remain in the shell.
2. Apply requires `setup:google-ads-schema:apply`, `--apply`, `CONFIRM_WRITE=YES` and `CONFIRM_GOOGLE_ADS_SCHEMA=YES` together.
3. DEV/profile guard rejects UAT and Production before a write-capable operation.
4. A fresh Preview must have zero conflicts, warnings and blocking manual actions before the first write.
5. Meta/shared dependencies and the Canonical core compatibility gate must pass.
6. Apply permits only create table, create field, add-only Select update, create Link, create View and update View actions.
7. Rename, delete, Record write and existing field-type mutation actions remain impossible in the Google phase.
8. Writes are sequential and confirmed progress is attached to failures.
9. Rerun reconciles exact table/field/option/Relation/View identity and does not duplicate resources.
10. Relations are deferred until every referenced Table ID exists.
11. Final read-back must report zero actions, conflicts, warnings and blocking manual decisions.
12. Real Table IDs are returned only as operator output for ignored `.dev.vars` / `wrangler.sync.jsonc`.
13. Connector, Worker endpoint and every Google Ads Business Schedule remain disabled after Schema Apply.

## Commands

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

Operator commands after merge, active Lark permission, completed Meta zero drift, resolved semantic decisions and a new exact authorization:

```bash
npm run setup:shared-table-schema
CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply
npm run setup:shared-table-schema

npm run setup:google-ads-schema
CONFIRM_WRITE=YES CONFIRM_GOOGLE_ADS_SCHEMA=YES npm run setup:google-ads-schema:apply
npm run setup:google-ads-schema
```

## Implementation result

### Files changed

- Config/schema contracts: Google RAW, Canonical extensions/core, Select options, Relations, Views, runtime guard and Lark table mappings.
- Application: Preview planner, Canonical compatibility checker, dependency/option/Relation/View planner and sequential Apply use case.
- Scripts: read-only setup command and exact confirmation guard.
- Tests: contract, runtime guard, installer mode, Preview, Apply, partial failure, idempotent rerun and stateful Lark fixture.
- Documentation/config examples: current task, project-brain record, package commands and placeholder-only Wrangler mappings.

### Verification

Final Branch Verification run `29857040248` on head `7e84005b29b430073774b24539e4908b37cbf365` passed every workflow stage:

- dependency install: PASS;
- syntax, architecture and repository hygiene: PASS;
- focused staged TikTok regression: 4/4;
- Node Unit/Integration: 550/550;
- Workers runtime: 9/9;
- Report reliability: 70/70;
- dependency audit at high severity: PASS;
- Wrangler deployment dry-run: PASS.

The five focused Google Ads files are included in the successful 550-test Unit/Integration run and cover 18 Google Ads-specific tests.

### Safety result

- **Live Lark Apply:** not run
- **Business Record read/write:** none
- **Google Ads API / GAQL:** not called
- **Cloudflare deploy / Queue / D1 / Schedule:** unchanged
- **Protected source mutation:** none
- **UAT / Production mutation:** none
- **PR state:** Draft; not merged

## Remaining live blockers

1. Lark app version containing `base:table:update` must become active.
2. PR #10 / Meta shared-table code must be merged before this PR, or PR #11 must be rebased after it; the live Meta Apply then must pass read-back and zero drift.
3. Live Canonical Ads v2 compatibility must pass after Meta; Google Apply will fail closed on missing/type-mismatched core fields.
4. Approve one semantic value for `google_other_ads` versus shared `google_other` when live options are read back.
5. Give a fresh exact authorization after reviewing the live Google Preview.

## Next gate

Keep PR #11 as Draft for independent final diff/document review. Do not merge or run live commands yet. After the dependency and permission gates are closed, merge in the correct order, run Meta Preview/Apply/zero drift, then run a fresh Google Preview and request exact authorization for the Google Schema Apply.