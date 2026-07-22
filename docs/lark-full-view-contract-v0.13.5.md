# Lark Full View Contract v0.13.7

## Status and approval

- **Contract status:** `implemented_and_verified_in_dev`
- **Current correction:** `repository-audit-v0.13.7`
- **Target:** developer-owned DEV / `dev_ft_pumkin`
- **View population:** 133 Views across 42 physical tables
- **Business Record scope:** prohibited
- **Create/Delete/Rename Table, Field, View or Record:** prohibited for Google Filter maintenance
- **Current Live state:** zero drift; do not rerun Apply

This contract separates `managed business contract` from `baseline-preservation contract`. It does not infer Filter, Sort or Hidden-field meaning from a View name.

## Contract classes

| Class | Views | Filter contract | Sort contract | Hidden-field contract | Behavior |
|---|---:|---|---|---|---|
| Shared-table managed | 17 | Exact source contract | None unless separately stated | Exact source contract | Verify/maintain |
| Report managed | 6 | Exact report contract | `rank asc` automatic | Exact report contract | Verify/maintain |
| Google Ads managed | 19 | Exact Google contract | None | None | Update Filter only |
| All/default baseline | 36 | None | None | None except protected TikTok `SourceID` | Preserve |
| Legacy specialized baseline | 55 | None | None | None | Preserve; no inferred business meaning |

Total: `17 + 6 + 19 + 36 + 55 = 133`.

Filtered Views: `17 + 6 + 19 = 42`.

## Baseline-preservation rule

For the 55 specialized Views without an exact approved contract:

1. Purpose is `legacy saved view preserved for owner/admin inspection`.
2. Filter/Sort/Hidden fields remain exactly as the verified baseline.
3. A name such as Active, Latest, Failed, Connection Issues or High Spend Low ROAS is not sufficient evidence for business logic.
4. Any future contract must specify Table, exact View name, purpose, conjunction, conditions, Sort, Hidden fields and evidence.
5. Changes require a separate approved task.

## All/default policy

For 36 All/default Views:

- Filter = `NONE`
- Sort = `NONE`
- Hidden fields = `NONE` by default
- `RAW_TikTok_Creator_Videos / 📋 All Records` preserves hidden `SourceID`
- audience is owner/admin unless Advanced Permission explicitly allows otherwise

## Managed Google Filter contract

Source of truth: `packages/config/src/google-ads-view-filters.js`.

### Explicit Views

- `Google Ads Accounts`: `platform is google_ads`
- `YouTube Ads Campaigns`: `platform is google_ads AND ad_channel is youtube_ads`
- `Google Ads Daily 30D`: managed `platform is google_ads` plus UI-owned rolling last 30 days
- `YouTube Video Assets`: `platform is google_ads AND creative_type is video`
- `Performance Max Asset Groups`: `platform is google_ads`
- `Conversion Actions UAT`: `status is ENABLED OR status is UNKNOWN`

### RAW error Views — stable-key-only minimum

The 13 RAW error Views intentionally check only the Primary raw stable key:

```text
conjunction = and
operator    = isEmpty
field       = primary raw stable key
```

This detects missing raw identity. It does not validate every supporting customer/entity/status/report/policy field. Comprehensive Data Quality validation requires a separate approved contract.

### Request rules

- Select values resolve to Live Option IDs.
- Valueless empty-key conditions use `isEmpty`.
- List Views is not sufficient for idempotency; hydrate with Get View.
- Filter and Hidden fields use separate mutations.
- Relative-date response metadata is UI-owned and must not be replayed as inferred request schema.

## Google maintenance no-create rule

The generic report View installer supports `create_view` for legitimate setup tasks. The Google Ads maintenance command is strictly update-only.

Before Apply:

1. Preview must be `readyToApply=true`.
2. `createViews` must equal `0`.
3. Every action must be `update_view`.
4. Missing managed View blocks with `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`.
5. The wrapped Lark client rejects any `createView` call with `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`.

This defense-in-depth guard also protects against a View disappearing between pre-Apply Preview and the generic Apply Preview.

## Sort and Hidden-field policy

- Report Views 6 preserve `rank ascending` and automatic sorting.
- Google managed Views 19 have no managed Sort and no hidden fields.
- All/default and legacy specialized Views use baseline-preservation policy.
- Google Filter Apply does not modify Sort, Hidden fields or Advanced Permission.

## Formula ownership

Formula fields are outside View mutation:

- `MKT_Ads_Campaigns.budget`
- `MKT_Ads_Daily.all_conversion_value`
- `MKT_Ads_Daily.cost_per_conversion`
- `MKT_Ads_Daily.conversion_rate`

All are Live verified `4/4`. Do not reapply.

## Current verification baseline

```text
Tables                      42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Google filters            19/19
Shared filters            17/17
Report Views                6/6
Formula fields              4/4
Identity drift                0
Filter/Sort/Hidden drift  0/0/0
```

## Out of scope

- Connector/source API
- Business Record reads/writes
- Worker/Queue/D1
- Cron/Schedule
- Secrets
- deployment
- Production
- 55 specialized business-view contracts
- comprehensive RAW data-quality checks
