# Meta Data Model v0.12.0 — Approved Contract

## Approval

The user approved this Data Model on `2026-07-21` for guarded application to the isolated customer-real UAT Lark Base.

Approval permits Lark schema work only. Connector implementation, live source calls, business-data writes, Cloudflare rollout, advertisement creation and spend remain blocked.

## Scope

One approved design covers:

- Facebook Organic
- Instagram Organic
- Meta Ads for Facebook and Instagram placements through one shared Marketing API connector

## Source tables

Facebook Organic:

- `RAW_Facebook_Pages`
- `RAW_Facebook_Posts`
- `RAW_Facebook_Post_Insights`
- `RAW_Facebook_Page_Insights`

Instagram Organic:

- `RAW_Instagram_Accounts`
- `RAW_Instagram_Media`
- `RAW_Instagram_Media_Insights`
- `RAW_Instagram_Account_Insights`

Meta Ads:

- `RAW_Meta_Ad_Accounts`
- `RAW_Meta_Campaigns`
- `RAW_Meta_Ad_Sets`
- `RAW_Meta_Ads`
- `RAW_Meta_Creatives`
- `RAW_Meta_Ads_Insights`

## Canonical mapping

Organic uses:

- `MKT_Accounts`
- `MKT_Account_Daily`
- `MKT_Content`
- `MKT_Content_Daily`

Ads uses the existing Canonical Ads v2 model:

- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

Meta Ad Set maps to canonical Ads Ad Group. Ad and Creative are separate identities.

## Core decisions

- Canonical business keys stay stable between UAT and Production.
- Instagram `/me` identity is authoritative; Insights resource aliases cannot replace it.
- Platform identifiers are Text.
- Raw source timestamps are retained before canonical date derivation.
- Organic reporting dates use `Asia/Bangkok`.
- Ads reporting dates use the advertising-account timezone.
- Observed zero remains zero.
- Missing or unsupported metrics remain null or absent according to contract.
- Authorized empty Ads data is `valid_no_data`.
- Missing source coverage is `NOT_TESTABLE_YET`, not failure.
- Raw Ads action/conversion arrays remain structured until a later approved action mapping.
- Canonical money uses safe integer micros.
- Schema apply is idempotent and non-destructive.

## Approved artifacts

Durable source-controlled contract:

- `docs/meta-blueprint-v0.12.0/`

User-facing workbook handoff:

- `Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0_APPROVED.xlsx`
- SHA-256: `4c49148b84051b221cdf4eca7b16315421e03812e6d058bb6ac4978a531bc02d`

The source-controlled CSV contracts are the durable field-level authority for table names, field types, required/nullability, stable keys, relations, Select options, source paths, metric definitions, timestamp semantics, zero/null behavior, examples, import notes, Raw-to-Canonical mapping and UAT gates. The Excel workbook is the review and import handoff representation of the same contract.

## Next gate

Apply and verify the approved schema in the isolated UAT Base. Connector implementation remains blocked until live schema parity and idempotent re-apply pass independent review.
