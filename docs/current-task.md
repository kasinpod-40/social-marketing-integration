# Current Task — Meta Blueprint Approval & Lark UAT Schema Apply v0.12.0

## Status

- **Task status:** `approved_for_schema_apply`
- **Accepted code baseline:** `9c23b56f319c50dbad9e1acc3eb1f339a74c55bc`
- **Merged review:** `PR #6`
- **Working branch:** `work/meta-blueprint-approved-v0.12.0`
- **Approved source contract:** `docs/meta-blueprint-v0.12.0/`
- **Approved workbook handoff:** `Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0_APPROVED.xlsx`
- **Workbook SHA-256:** `b18b2020de1bfc95b33f6b0d202d35913a12d997a57d2a53c5011a95223d38cb`
- **Target profile:** `uat_chemistry_k`
- **Target environment:** `uat`
- **Connector implementation:** `blocked_until_schema_apply_verified`
- **Approval recorded:** `2026-07-21`

The user approved Meta Data Model / Lark Blueprint v0.12.0 for guarded application to the isolated customer-real UAT Lark Base. This approval authorizes schema work only. It does not authorize connector coding, live source calls, business-data writes, Cloudflare rollout, advertisement creation or spend.

## Approved preflight state

- Facebook Organic: `PASS`
- Instagram Organic: `PASS`
- Meta Ads access: `PASS`
- Meta Ads data: `valid_no_data`
- Meta Ads Data UAT: `PENDING`
- Reels, Video, Carousel, Stories and multi-page pagination coverage: `NOT_TESTABLE_YET`

Detailed DEV evidence and observed response shapes are recorded in the approved workbook. The durable source-controlled field and mapping contract is under `docs/meta-blueprint-v0.12.0/`.

## Approved Data Model

### Raw/source tables — 14

Facebook Organic:

1. `RAW_Facebook_Pages`
2. `RAW_Facebook_Posts`
3. `RAW_Facebook_Post_Insights`
4. `RAW_Facebook_Page_Insights`

Instagram Organic:

5. `RAW_Instagram_Accounts`
6. `RAW_Instagram_Media`
7. `RAW_Instagram_Media_Insights`
8. `RAW_Instagram_Account_Insights`

Meta Ads:

9. `RAW_Meta_Ad_Accounts`
10. `RAW_Meta_Campaigns`
11. `RAW_Meta_Ad_Sets`
12. `RAW_Meta_Ads`
13. `RAW_Meta_Creatives`
14. `RAW_Meta_Ads_Insights`

### Canonical destination mapping

Organic:

- `MKT_Accounts`
- new `MKT_Account_Daily`
- `MKT_Content`
- `MKT_Content_Daily`

Ads:

- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

Meta Ad Set maps to canonical Ads Ad Group. Ad and Creative identities remain separate.

## Locked contracts

- UAT profile is environment identity only; canonical customer/account keys remain stable across UAT and Production.
- Instagram canonical identity comes from `/me`; an Insights resource prefix is audit metadata only.
- Meta IDs remain Text and are never coerced through unsafe numeric types.
- Raw timestamps and `end_time` values are retained exactly.
- Organic canonical dates use `Asia/Bangkok`; Ads dates use the advertising-account timezone.
- Numeric `0` remains `0`; missing/unsupported metrics remain null or absent according to the metric contract.
- `valid_no_data` is an authorized empty result, not an error and not a successful-data claim.
- `NOT_TESTABLE_YET` is explicit coverage debt, not failure.
- Raw Ads action lists remain structured data until a later approved conversion mapping exists.
- Canonical money uses safe integer micros.
- Schema application must be idempotent and non-destructive.

## Authorized scope

The schema task may:

- use the approved source contract and workbook handoff;
- inspect the isolated UAT Base before mutation;
- create missing approved Raw tables;
- create `MKT_Account_Daily` if absent;
- reconcile approved fields, types, Select options, relations and import notes;
- reuse existing canonical tables rather than create duplicates;
- record non-secret Table/Field mappings in the environment-specific configuration path;
- run an idempotent second apply and post-apply schema comparison;
- record actual Lark limitations as explicit reviewed exceptions.

## Out of scope

- Meta connector implementation or activation
- Live Facebook, Instagram or Marketing API calls
- Customer source-data reads or destination business-data writes
- Advertisement creation, activation or spend
- Cloudflare resource creation, migration or deployment
- Live Queue messages or schedule activation
- Production mutation

## Acceptance criteria

1. Confirm the target is the isolated UAT Base before the first mutation.
2. Record the pre-apply table/field/options/relation inventory.
3. All 14 approved Raw tables exist exactly once.
4. `MKT_Account_Daily` exists exactly once with the approved Account×Date stable key.
5. Existing Organic and Ads canonical tables are reused with approved compatible additions only.
6. Actual fields, types, options, relations and notes match the approved contract or have an explicit reviewed exception.
7. Stable-key fields are Text and independent of mutable display names.
8. No fake, sample, DEV, customer or Ads performance rows are inserted.
9. A second schema apply creates no duplicate tables or fields and makes no destructive change.
10. Table/Field mappings are recorded without secrets.
11. TikTok, YouTube, Core and existing Ads contracts remain unchanged.
12. Applicable Repository gates pass when tooling or source-controlled mappings change.

## Verification

Minimum live evidence:

- UAT Base identity
- before/after table inventory
- before/after affected-field inventory
- Select-option and relation checks
- stable-key primary-field checks
- idempotent second apply
- secret-safe failure diagnostics

Repository gates when files or tooling change:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Implementation result

- **Blueprint:** `APPROVED`
- **Schema apply:** `authorized_not_started`
- **Connector implementation:** `blocked`
- **Live source UAT:** not authorized in this task

## Next gate

After the actual UAT Lark schema passes independent review, create a separate Meta connector implementation task covering pagination, identity preflight, Raw writes, normalization, checkpoints, locks, retries, DLQ, reconciliation, Schedule flags and regression testing.
