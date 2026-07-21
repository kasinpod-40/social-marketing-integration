# Google Ads Schema Apply v0.13.0 RC1

## Status

- Source implementation: complete on Draft PR #11
- Live Lark Apply: not run
- Google Ads connector / GAQL / Worker endpoint / Queue / Schedule: not implemented or enabled by this task
- UAT and Production: untouched
- Required live order: Meta/shared schema Apply → Meta zero drift → Google fresh Preview → exact authorization → Google Apply → Google zero drift

## Source of truth

The approved workbook `Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx` defines:

- 13 Google-specific RAW tables;
- 208 RAW field definitions;
- one new Canonical table, `MKT_Ads_AssetGroups`;
- 44 Canonical definitions/extensions;
- add-only Select options;
- approved Relations and Views;
- `10_Apply_Plan` and `11_UAT_Checklist` acceptance gates.

The repository stores only sanitized schema metadata derived from the workbook. It does not store Manager/Customer IDs, real Lark Table IDs, credentials, OAuth data, developer tokens, authorization headers, billing data, or record payloads.

## Physical table strategy

Google-specific RAW tables remain separate from the shared Meta/TikTok Ads staging tables:

- `RAW_Google_Ads_*` preserves exact Google resource and GAQL reporting contracts;
- `RAW_Ads_Entities` and `RAW_Ads_Daily` remain normalized shared adapter outputs;
- the two layers must not be treated as competing sources of truth at the same grain.

The Google phase creates exactly:

1. `RAW_Google_Ads_Account_Links`
2. `RAW_Google_Ads_Accounts`
3. `RAW_Google_Ads_Campaign_Budgets`
4. `RAW_Google_Ads_Campaigns`
5. `RAW_Google_Ads_Ad_Groups`
6. `RAW_Google_Ads_Ads`
7. `RAW_Google_Ads_Assets`
8. `RAW_Google_Ads_Ad_Assets`
9. `RAW_Google_Ads_Asset_Groups`
10. `RAW_Google_Ads_Asset_Group_Assets`
11. `RAW_Google_Ads_Conversion_Actions`
12. `RAW_Google_Ads_Daily`
13. `RAW_Google_Ads_Conversion_Daily`
14. `MKT_Ads_AssetGroups`

It reuses, and must never duplicate:

- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

## Data rules

- The first field of every RAW table is the only Primary field and is Text.
- All Google Ads identifiers are Text to preserve long numeric IDs.
- Delivery Ad, reusable Asset/Creative, and Performance Max Asset Group remain distinct entities.
- Ad ↔ Asset is many-to-many through `RAW_Google_Ads_Ad_Assets` and Canonical `creative_links`.
- Performance Max Asset Group must never be normalized as Ad Group.
- Money source of truth is integer micros; divide by 1,000,000 only for display/normalization.
- Daily date uses `segments.date` in the source account timezone.
- Explicit zero remains zero; null is only for unsupported or unreturned source fields.
- `segment_key != all` remains RAW-only for Canonical V1.
- Conversions and All conversions remain separate.
- Conversion Actions remain separate until an approved conversion set exists.

## Contract resolutions

### `link_status`

`RAW_Google_Ads_Account_Links.link_status` is implemented as `SingleSelect`, not Text, because the workbook also defines the controlled values:

- `selectable`
- `not_selectable`
- `unknown`

### Formula hints

The four workbook formula expressions are retained as metadata hints but are not installed as Lark Formula fields in this Schema task. The physical fields remain Number fields, and the future normalization/display implementation must use blank-aware calculations so explicit zero never becomes blank.

### `google_other_ads`

The Google contract requests `google_other_ads`, while the shared Meta contract may already contain `google_other`. The Preview raises `GOOGLE_ADS_OTHER_CHANNEL_OPTION_DECISION_REQUIRED` and refuses Apply when both semantics would coexist without an approved decision.

### Relations

Seven explicit Link fields from `03_Canonical_Extensions` are implemented. The broader text in `09_Relations_Views` about additional `MKT_Ads_Daily` links does not authorize inventing five undeclared physical field names.

### Views

Lark Views are table-scoped. The logical `Google Ads RAW Errors` view is expanded into 13 physical views, one per Google RAW table. `Google Ads Daily 30D` installs the confirmed platform filter; rolling relative-date filtering remains a non-blocking Lark UI review because the verified OpenAPI path does not expose a durable relative-date filter contract.

## Safety gates

The Preview is always read-only and requires only list/get methods. The Apply requires all of:

- the dedicated `setup:google-ads-schema:apply` command;
- `--apply` supplied by the package script;
- `CONFIRM_WRITE=YES`;
- `CONFIRM_GOOGLE_ADS_SCHEMA=YES`;
- `MKT_ENV=development`;
- `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`;
- Meta/shared dependency tables present under their final names;
- five pre-Meta legacy table names absent;
- Canonical Ads v2 core fields present with exact compatible types;
- protected `RAW_TikTok_Creator_Videos` found uniquely with zero planned actions;
- zero conflicts, warnings, blocking manual actions, deletes, renames, record writes, or field-type mutations.

## Apply lifecycle

1. Fresh live Preview.
2. Sequential table/field/add-only option actions.
3. Fresh Preview after table creation to resolve actual Table IDs.
4. Sequential Relation creation.
5. Fresh Preview after Relations.
6. Table-scoped View Apply.
7. Final read-back Preview requiring zero remaining drift.
8. Return logical config key → real Lark Table ID updates for ignored local configuration only.

Confirmed progress is attached to typed failures. A rerun reconciles existing tables, fields, options, Relations, and Views rather than duplicating them.

## Commands

```bash
npm run setup:google-ads-schema

CONFIRM_WRITE=YES \
CONFIRM_GOOGLE_ADS_SCHEMA=YES \
npm run setup:google-ads-schema:apply

npm run setup:google-ads-schema
```

These commands must not be run live until the Lark permission version is active, Meta/shared Apply has passed live zero drift, blocking semantic decisions are resolved, and the user gives a fresh exact authorization.
