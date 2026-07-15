# Multi-channel Foundation Review v0.10.1

## Release status

`v0.10.1-multi-channel-foundation-reviewed` closes the code/data-contract review findings from v0.10.0 without activating any new connector or mutating Lark, D1, Cloudflare, YouTube, Meta, WooCommerce, Chatwoot, or Ads resources.

Runtime status remains:

- TikTok Organic: `active` and Live DEV verified.
- YouTube Organic: `uat_pending`, fail-closed, no Worker route.
- Meta, WooCommerce, Chatwoot, and Ads: `planned`, no Worker route.

## YouTube request and quota contract

`videos.list` continues to batch no more than 50 video IDs, but an ID-filtered request now sends only supported parameters:

```text
part
id
```

It does not send `maxResults` with `id`. `playlistItems.list` still uses `maxResults=50`, where pagination is supported.

Error policy:

```text
HTTP 429 / 5xx / backendError
rateLimitExceeded / userRateLimitExceeded
→ bounded retry with backoff

quotaExceeded
→ YOUTUBE_QUOTA_EXHAUSTED
→ no short retry loop
→ terminal operational alert
→ wait for quota reset or approved quota increase
```

Official request/error references:

- <https://developers.google.com/youtube/v3/docs/videos/list>
- <https://developers.google.com/youtube/v3/docs/errors>
- <https://developers.google.com/youtube/v3/getting-started>

## Canonical Ads v2

Delivery hierarchy and reusable asset are now explicit:

```text
Account → Campaign → Ad group / Ad set → Ad
                                      ↘ Creative (reusable asset)
```

Ad and Creative have separate stable keys and tables:

```text
MKT_Ads_Ads
MKT_Ads_Creatives
```

An Ad may reference a Creative; an Adapter must not place an Ad ID in `external_creative_id` or use a Creative ID as `external_ad_id`.

Stable keys remain account-scoped:

```text
entity_key   = {platform}:{account_id}:{entity_type}:{external_entity_id}
ads_daily_key = {entity_key}:{metric_date}
```

Supported `entity_type` values are:

```text
account
campaign
ad_group
ad
creative
```

## Money precision

Money source fields use integer micros:

```text
spend_micros
conversion_value_micros
```

One currency unit equals `1,000,000` micros. Decimal strings from Source APIs must be parsed directly into integer micros without passing through a JavaScript floating-point input. Values must be non-negative safe integers.

Report-friendly fields are derived:

```text
spend            = spend_micros / 1,000,000
conversion_value = conversion_value_micros / 1,000,000
CTR               = clicks / impressions
CPC               = spend_micros / clicks / 1,000,000
CPM               = spend_micros / impressions * 1000 / 1,000,000
actual_roas        = conversion_value_micros / spend_micros
```

Missing components and zero denominators produce `null`. `target_roas` is never mapped to `actual_roas`.

## Reviewed Excel/Lark Blueprint

Canonical artifact:

```text
docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.1.xlsx
```

It contains:

- Table inventory and runtime/apply status.
- Three YouTube RAW table field contracts.
- Six Ads tables including separate Ad and Creative masters.
- Select options.
- Stable-key, money, metric, and null contracts.
- Blocking UAT checklist.
- Official/request-source traceability.

The workbook is a review/import artifact only. It does not Apply schema or write records.

## Activation gates

No new connector may become `active` until all relevant gates pass:

1. Authorized DEV credentials exist outside Source control.
2. Account/Channel identity preflight matches configuration.
3. Blueprint is reviewed and applicable tables are created in DEV Lark.
4. Live/sandbox payloads confirm Field, ID, money-unit, pagination, and null semantics.
5. Manual sync and idempotent rerun pass.
6. Reconciliation, lock, retry, DLQ, and alert behavior pass.
7. Report metric definitions are approved.
8. Schedule is enabled only after Manual UAT.

## Remaining external verification

- YouTube authorized payload/API UAT and Lark RAW Apply.
- Platform-specific Ads payload mapping for Ad versus Creative.
- Platform-specific conversion from decimal amount or native micros to canonical integer micros.
- Meta, WooCommerce, Chatwoot, and Ads adapters/routes remain later workstreams.
