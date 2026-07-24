# Meta Business Ingestion Contract v1

## Status

```text
CONTRACT_VERSION          = meta-business-ingestion-v1
PREPARATION_AUTHORIZED    = 2026-07-25
RUNTIME                   = development / integration_workspace
DESIGN                    = COMPLETE
LIVE_SOURCE_UAT           = PENDING_CUSTOMER_CREDENTIAL
CONNECTOR_IMPLEMENTATION  = NOT_AUTHORIZED_BY_THIS_CONTRACT
BUSINESS_WRITES           = NOT_AUTHORIZED
SCHEDULES                 = DISABLED
DEPLOYMENT                = NOT_AUTHORIZED
PRODUCTION                = BLOCKED
```

เอกสารนี้เตรียม Source/Normalization/Storage contract ระหว่างรอ Customer Meta
credential เท่านั้น ไม่อนุญาต Live API, Queue, D1/Lark business write,
Schedule, Deploy, App Review, Advertisement mutation หรือ Spend

Machine-readable authority:

`packages/config/src/meta-business-ingestion-contract.js`

## Existing data-model authority

ไม่สร้าง Physical table เพิ่ม Meta source ใช้เส้นทางเดียว:

```text
Provider GET
→ five existing Shared Raw tables
→ approved D1 historical/current/coverage tables
→ existing Canonical MKT tables
```

Shared Raw:

1. `RAW_Meta_Organic_Accounts`
2. `RAW_Meta_Organic_Content`
3. `RAW_Meta_Organic_Metrics`
4. `RAW_Ads_Entities`
5. `RAW_Ads_Daily`

Canonical Organic:

- `MKT_Accounts`
- `MKT_Account_Daily`
- `MKT_Content`
- `MKT_Content_Daily`

Canonical Ads:

- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

D1 remains governed by
`docs/project-brain/storage-architecture-and-migration-contract-v1.md`.
Provider-specific Raw → Canonical shortcuts and dual Raw writes are forbidden.

## Credential lifecycle

| Use | Secret | Rule |
| --- | --- | --- |
| Facebook Page/Ads discovery | `META_ACCESS_TOKEN` | User/System User credential; never emit from `/me/accounts` |
| Facebook Page business reads | `META_FACEBOOK_PAGE_ACCESS_TOKEN` | Separate Page credential after exact Page match |
| Instagram Organic | `META_INSTAGRAM_ACCESS_TOKEN` | Instagram User token on `graph.instagram.com` |
| Meta Ads | `META_ACCESS_TOKEN` | Independent result/state from Facebook Organic |

All requests use an Authorization Bearer header. A token must never be put in a
URL, Source, fixture, Queue payload, D1/Lark business row, log or error.

The official Meta Facebook collection documents that `/me/accounts` exchanges a
User credential for Page credentials. Runtime implementation must either receive
the exact Page token through the Secret boundary or derive it only in memory
after exact Page matching. It must never return or persist it as ordinary config.

Instagram Login business reads require:

```text
instagram_business_basic
instagram_business_manage_insights
```

Identity preflight success with only `instagram_business_basic` is not Insights
readiness.

## Source datasets

Every dataset is `GET`-only, uses a pinned API version and stays
`live_fixture_required`.

### Facebook Organic

Host:

```text
https://graph.facebook.com
```

Datasets:

| Dataset | Path | Purpose |
| --- | --- | --- |
| `facebook.account.latest` | `/{page_id}` | Page identity/latest state |
| `facebook.content.inventory` | `/{page_id}/posts` | Page-owned content inventory |
| `facebook.content.insights` | `/{content_id}/insights` | Content metrics |
| `facebook.account.insights` | `/{page_id}/insights` | Page daily metrics |

The Page/content fields and candidate Insight metrics are locked in the
machine-readable contract. Metric names must pass one minimal Customer Live
fixture before an adapter is allowed to write. Unsupported/deprecated metrics
become `null`/no row with Coverage evidence; the adapter must not guess a
replacement.

### Instagram Organic through Instagram Login

Host:

```text
https://graph.instagram.com
```

Datasets:

| Dataset | Path | Purpose |
| --- | --- | --- |
| `instagram.account.latest` | `/me` | Canonical `/me` identity/latest state |
| `instagram.content.inventory` | `/me/media` | Owned professional media |
| `instagram.content.insights` | `/{media_id}/insights` | Media metrics |
| `instagram.account.insights` | `/me/insights` | Account metrics |

The API returns UTC timestamps. Raw source time is retained before deriving the
`Asia/Bangkok` reporting date. Official limitations such as unavailable metrics,
media-type differences and bounded Account Insights history must remain visible
as Coverage status rather than fabricated zero.

### Meta Ads

Host:

```text
https://graph.facebook.com
```

Inventory:

```text
/act_{ad_account_id}
/act_{ad_account_id}/campaigns
/act_{ad_account_id}/adsets
/act_{ad_account_id}/ads
/act_{ad_account_id}/adcreatives
```

Performance:

```text
/act_{ad_account_id}/insights
level=ad
time_increment=1
breakdowns=publisher_platform
action_breakdowns=action_type
```

Meta Ad Set maps to Canonical `ad_group`; Ad and Creative remain separate
identities. `publisher_platform` maps to `facebook_ads` or `instagram_ads`.
`actions` and `action_values` remain structured JSON. No total Conversions,
Conversion value, CPA or ROAS is published until the customer approves the exact
`action_type` mapping.

## Stable keys

```text
Raw Organic account
  {platform}:{source_account_id}

Raw Organic content
  {platform}:{source_account_id}:{source_content_id}

Raw Organic metric
  {platform}:{entity_type}:{source_entity_id}:{metric_name}:{period}:{source_time_key}

D1 Organic content
  {platform}:{account_key}:{external_content_id}

D1 Organic observation
  {content_key}:{observed_at}:{observation_kind}:v1

Raw/D1 Ads entity
  {platform}:{account_key-or-account_id}:{entity_type}:{external_entity_id}

Raw Ads daily
  {platform}:{account_id}:{entity_type}:{external_entity_id}
  :{metric_date}:{breakdown_key}

D1 Ads daily
  {platform}:{account_key}:{report_level}:{external_entity_id}
  :{metric_date}:{breakdown_key}:{segment_key}

D1 Ads conversion daily
  {platform}:{account_key}:{report_level}:{external_entity_id}:{metric_date}
  :{conversion_action_key}:{conversion_category}:{segment_key}
```

`none` is required for an absent breakdown/segment inside a Stable key. External
IDs remain Text. Retry of one generation must reuse `fetched_at`, `observed_at`,
Coverage ID and Stable keys.

## Time, metric and money semantics

- Organic source timestamps are stored exactly; reporting dates use
  `Asia/Bangkok`.
- Ads `metric_date`, Currency and Timezone come from the exact Ad Account.
- Dashboard ingestion covers 90 completed days; Ads requests are split into
  bounded 31-day chunks.
- The 90-day Organic target is a reporting/Coverage target, not permission to
  synthesize historical lifetime snapshots. If the Provider cannot supply the
  required baseline, the period remains `partial`.
- Recent Ads facts are re-read for a bounded 35-day revision window. An incoming
  Source revision may update the same Stable key but never add a duplicate.
- Cumulative Organic values create observations only for initial/change/
  correction/checkpoint/backfill.
- Missing/unsupported is `null` or no row; an observed zero remains `0`.
- Negative provider correction is retained where the metric contract permits.
- Decimal money is parsed from the exact string into safe integer micros; JS
  floating-point multiplication is forbidden.
- Derived ratios are calculated after aggregation; a missing/zero denominator
  returns `null`.

## Bounded reliability contract

```text
timeout                30 seconds
max pages              100
page size              100
max attempts           5
max response body      8 MiB
max connector requests 2 concurrent
```

Required phases:

1. exact customer/account identity preflight;
2. create resumable Work generation and Coverage run;
3. fetch/stage complete bounded units without business writes;
4. validate response shape, identities, duplicates, time and metric semantics;
5. normalize Stable keys and hashes;
6. write D1 unit atomically only after complete unit validation;
7. checkpoint cursor after D1 write;
8. mirror bounded customer-visible state to Lark only in a separately approved
   PR after D1 parity;
9. mark Coverage `complete`, `partial`, `no_data_confirmed`,
   `source_unavailable`, `not_observed` or `revisable`.

One dataset failure must not relabel another dataset as success. Partial
responses never delete facts outside the response. Only a complete full
reconciliation may mark missing entities.

## Implementation PR boundaries

1. Source request/fixture contracts and read-only adapters; no writers.
2. Pure normalizers, Stable keys, money parser and fixture tests.
3. D1 write/reconciliation hooks behind default-false flags.
4. Manual Integration Workspace Live UAT with exact customer assets.
5. Lark mirror only after D1 parity and explicit approval.
6. Schedule and Production remain separate approvals.

## Live UAT gates

- [ ] Customer-app administrator restored and verified.
- [ ] Orphaned Facebook credential rotated.
- [ ] Exact Page, Instagram Account and Ad Account mappings pass preflight.
- [ ] Exact Page access credential lifecycle passes without token exposure.
- [ ] Facebook fields and candidate metrics pass minimal Live fixtures.
- [ ] Instagram IMAGE/VIDEO/REEL/CAROUSEL coverage is recorded where available.
- [ ] Instagram Account Insights returns approved time/aggregate shapes.
- [ ] Meta Ads inventory is readable without creating or editing Ads.
- [ ] Empty Ads Insights is recorded as `no_data_confirmed`, not fake success.
- [ ] Non-empty Ads fixture proves daily date, Currency, Timezone, breakdown and
      action-array semantics without unauthorized Spend.
- [ ] Pagination, duplicate detection, rate limits and partial failure pass.
- [ ] Idempotent rerun produces zero duplicate Stable keys.
- [ ] Existing TikTok, YouTube, Google and Report regressions pass.
- [ ] All feature flags and schedules remain disabled until separate approval.

## Current boundary

This contract allows Source-code review and later mocked adapter implementation
only after `docs/current-task.md` opens that exact PR scope. It does not authorize
Live calls or business writes.

## Primary references reviewed

- Meta official Facebook API workspace:
  `https://www.postman.com/meta/facebook/overview`
- Meta official Instagram Insights collection:
  `https://www.postman.com/meta/instagram/folder/23987686-f659d7d1-d74c-44e4-9192-9b1e8694c511`
- Meta official Facebook Marketing API workspace:
  `https://www.postman.com/meta/facebook-marketing-api/overview`
- Repository field/grain authorities:
  `docs/shared-table-blueprint-v0.12.1/fields.csv` and
  `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
