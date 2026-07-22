# Lark Full View Audit v0.13.7

## Status

- **Mode:** `FINAL_CONFIGURATION_AUDIT`
- **Source baseline before correction:** `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- **Correction branch:** `work/repository-audit-corrections-2026-07-22`
- **Target:** developer-owned DEV / `dev_ft_pumkin`
- **Source export:** `Social MKT Data Hub(11).base`
- **Business Record access:** none
- **Lark mutation during this audit:** none

## Executive result

| Gate | Result |
|---|---:|
| Physical tables | 42 |
| Fields | 737 |
| Views | 133 |
| Filtered Views | 42 |
| Sorted Views | 6 |
| Views with hidden fields | 7 |
| Duplicate table names | 0 |
| Table emoji/folder placement | 42/42 |
| View emoji names | 133/133 |
| Formula fields | 4/4 |
| Shared managed Views | 17/17 |
| Report managed Views | 6/6 |
| Google managed Views | 19/19 |
| Identity drift | 0 |
| Filter/Sort/Hidden drift | 0/0/0 |

`Google Ads Daily 30D` is verified as:

```text
platform = google_ads
metric_date = TheLastMonth
conjunction = and
```

## Contract classification

The 133 Views are classified as:

| Class | Count | Expected state |
|---|---:|---|
| Shared-table managed | 17 | Exact managed Filter contract |
| Report managed | 6 | Exact Filter + rank ascending + Hidden-field contract |
| Google Ads managed | 19 | Exact managed Filter contract |
| All/default baseline | 36 | Complete-table inspection; no Filter/Sort by default |
| Legacy specialized baseline | 55 | Preserve verified state; no inferred business semantics |

The 42 filtered Views are exactly:

```text
17 Shared + 6 Report + 19 Google = 42
```

## Important interpretation

“Full View contract complete” means every View is accounted for as managed or explicitly preserved.

It does not mean every specialized View name already has matching business logic. The following kinds of names must not be treated as executable contracts by themselves:

- Active
- Connected
- Connection Issues
- Latest
- Failed
- Critical
- High Spend Low ROAS
- platform-specific saved names without an approved condition matrix

The 55 specialized Views remain unchanged until a separate business-owner contract specifies Table, exact View name, purpose, conjunction, conditions, Sort, Hidden fields and evidence.

## Shared-table managed Views — 17/17

Shared-table Views use the approved `platform`, `entity_type` and `ad_channel` separation contract. Exact filters are verified against the current Source contract.

No shared managed View drift remains.

## Report managed Views — 6/6

All six Report Views preserve:

- exact report Filter contract;
- `rank` ascending;
- automatic sorting;
- approved Hidden fields;
- no identity drift.

## Google Ads managed Views — 19/19

### Explicit Views

- `🏦 Google Ads Accounts`
- `📺 YouTube Ads Campaigns`
- `📈 Google Ads Daily 30D`
- `🎬 YouTube Video Assets`
- `🗂️ Performance Max Asset Groups`
- `🎯 Conversion Actions UAT`

### RAW error Views

13 Google RAW error Views use stable-key-only minimum QA:

```text
primary raw stable key isEmpty
conjunction and
```

This detects missing raw identity. It does not validate every customer/entity/status/report/policy field.

A comprehensive Data Quality contract must be a separate task.

## Formula fields — 4/4

Verified expressions:

```text
MKT_Ads_Campaigns.budget
IF(ISBLANK([budget_micros]),"",[budget_micros]/1000000)

MKT_Ads_Daily.all_conversion_value
IF(ISBLANK([all_conversion_value_micros]),"",[all_conversion_value_micros]/1000000)

MKT_Ads_Daily.cost_per_conversion
IF(OR(ISBLANK([conversions]),[conversions]=0,ISBLANK([spend])),"",[spend]/[conversions])

MKT_Ads_Daily.conversion_rate
IF(OR(ISBLANK([clicks]),[clicks]=0,ISBLANK([conversions])),"",[conversions]/[clicks])
```

Three monetary/value fields use two decimal places. `conversion_rate` uses percentage with decimals.

## Google maintenance safety

The generic report View installer can create Views for legitimate setup workflows. Google Ads maintenance is update-only and now requires:

- `readyToApply=true`;
- `createViews=0`;
- all actions `update_view`;
- missing View blocker `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`;
- defense-in-depth `createView` rejection.

This is a future-maintenance guard. The current Base is already zero drift and must not be reapplied.

## Permissions and audience

- All/default and technical Views are owner/admin inspection surfaces unless Advanced Permission explicitly grants access.
- RAW, Daily, Sync and System tables are not normal client-facing surfaces.
- Production permissions belong to the customer-owned Lark organization.

## Final decision

```text
LARK_SCHEMA                       PASS
LARK_TABLES_FIELDS_VIEWS          42 / 737 / 133
LARK_MANAGED_FILTERS              42/42
LARK_FORMULAS                     4/4
LARK_FILTER_SORT_HIDDEN_DRIFT     0/0/0
LARK_SPECIALIZED_VIEW_CONTRACTS   55 PRESERVED / BUSINESS_CONTRACT_MISSING
LARK_APPLY_REQUIRED               NO
```

## Out of scope

- Business Record reads/writes
- connector implementation
- source API delivery
- Worker/Queue/D1
- schedule/deployment
- Production
- specialized View business-rule design
- comprehensive RAW data-quality rules
