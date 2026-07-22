# Google Ads Manager Script Signed Delivery Contract v1

## Status and authority

- Contract ID: `google_ads_signed_delivery_v1`
- Approved task: Google Ads Manager Script signed delivery connector
- Manager customer: `946-357-0541` (`9463570541` on the wire)
- Allowed advertiser: Chemistry K `566-233-2033` (`5662332033` on the wire)
- Canonical `customerKey`: `chemistry_k`
- Canonical connector `accountKey`: `chemistry_k`
- Source timezone: `Asia/Bangkok`
- Delivery route: `POST /v1/google-ads/deliveries`
- Schedule: disabled; this contract does not create or enable a schedule

This document is authoritative for the signed transport. Header names, signing input, payload fields, replay rules and limits must not be changed without a new contract version.

## Read-only source boundary

The Manager Script:

- selects exactly one allowlisted advertiser through `AdsManagerApp.accounts().withIds(...)`;
- verifies the selected account after `AdsManagerApp.select(...)`;
- reads through `AdsApp.search()` only;
- never creates, edits, pauses, enables or deletes Campaigns, Ad Groups, Ads, budgets, billing or account settings;
- starts in `DRY_RUN`;
- supports `PREVIEW` and manual one-shot `LIVE` only;
- contains no trigger or schedule creation API.

`campaign.start_date` and `campaign.end_date` remain present in the transport schema as nullable fields, but the Script sends `null` because the verified Google Ads Scripts runtime rejected those optional fields during read-only Preview.

## HTTP request

The exact endpoint URL must:

- use HTTPS;
- end at `/v1/google-ads/deliveries` exactly;
- contain no query string or fragment.

Content-Type must be `application/json`.

### Required headers

| Header | Contract |
|---|---|
| `x-mkt-key-id` | 1–64 characters: letters, digits, `.`, `_`, `-` |
| `x-mkt-timestamp` | exactly 10 decimal digits; Unix seconds |
| `x-mkt-nonce` | 22–64 URL-safe Base64 characters |
| `x-mkt-idempotency-key` | `google-ads:<deliveryId>` |
| `x-mkt-content-sha256` | 64 lowercase hex characters |
| `x-mkt-signature` | `sha256=<64 lowercase hex characters>` |

Every header must occur exactly once. Missing, empty or comma-joined duplicate values fail closed.

## Digest and signature

`x-mkt-content-sha256` is SHA-256 over the exact UTF-8 request body bytes before JSON parsing.

The signature algorithm is HMAC-SHA-256. The canonical signing input is exactly seven newline-separated lines with no trailing newline:

```text
MKT-HMAC-SHA256-V1
POST
/v1/google-ads/deliveries
<x-mkt-timestamp>
<x-mkt-nonce>
<x-mkt-idempotency-key>
<x-mkt-content-sha256>
```

The Worker computes the expected signature and compares it without an early-exit byte comparison.

Signing secrets remain in Script Properties and Cloudflare Secrets only. Current and previous key pairs may coexist during rotation:

- `MKT_GOOGLE_ADS_SIGNING_KEY_ID`
- `MKT_GOOGLE_ADS_SIGNING_SECRET`
- `MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID`
- `MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET`

Key IDs are non-secret. Secret values must never appear in Git, Lark, logs, docs or Queue messages.

## Timestamp and replay protection

- Accepted timestamp skew: at most 300 seconds in either direction.
- Nonce retention: 600 seconds.
- A nonce is reserved atomically in D1 with `INSERT OR IGNORE` after signature verification and before Queue submission.
- Reusing the nonce is rejected as `GOOGLE_ADS_DELIVERY_REPLAY_REJECTED`.
- A new nonce may retry the same request-level idempotency key and body digest.

## Request-level idempotency

- `deliveryId` must be UUID v4.
- The exact idempotency key is `google-ads:<deliveryId>`.
- Reusing that key with the same `deliveryId`, mode and body digest is idempotent.
- Reusing it with different content or mode is a permanent conflict.
- The Queue message contains only `schemaVersion`, job `type`, `deliveryId` and `requestedAt`; it never contains the signature, signing key, nonce or raw payload.

## Envelope

Unknown fields fail closed at every object level.

```json
{
  "schemaVersion": "google_ads_signed_delivery_v1",
  "deliveryId": "<UUID v4>",
  "mode": "PREVIEW | LIVE",
  "managerCustomerId": "9463570541",
  "customerId": "5662332033",
  "customerKey": "chemistry_k",
  "accountKey": "chemistry_k",
  "fetchedAt": "<UTC RFC3339 ending Z>",
  "sourceTimezone": "Asia/Bangkok",
  "datasetCounts": {
    "account": 1,
    "campaigns": 0,
    "adGroups": 0,
    "ads": 0,
    "youtubeAssets": 0,
    "campaignDailyMetrics": 0
  },
  "datasets": {
    "account": {},
    "campaigns": [],
    "adGroups": [],
    "ads": [],
    "youtubeAssets": [],
    "campaignDailyMetrics": []
  }
}
```

`datasetCounts` must exactly match the arrays. The body limit is 8 MiB.

## Six dataset schemas

### `account`

Exactly these fields:

```text
customerId, descriptiveName, currencyCode, timeZone, status,
isManager, isTestAccount, resourceName
```

Rules:

- `customerId` must equal `5662332033`;
- `timeZone` must equal `Asia/Bangkok`;
- `isManager` must be `false`;
- `currencyCode` is an uppercase ISO-style three-letter code.

### `campaigns`

Maximum 500 rows, sorted numerically by `campaignId`, with no duplicate ID.

```text
campaignId, campaignName, status, primaryStatus, servingStatus,
advertisingChannelType, advertisingChannelSubType, startDate, endDate,
biddingStrategyType, campaignBudgetId, campaignBudgetResourceName, resourceName
```

`startDate` and `endDate` are `YYYY-MM-DD` or `null`.

### `adGroups`

Maximum 2,000 rows, sorted numerically by `adGroupId`, with no duplicate ID.

```text
adGroupId, campaignId, adGroupName, status, primaryStatus, type, resourceName
```

Every `campaignId` must exist in `campaigns`.

### `ads`

Maximum 5,000 rows, sorted numerically by `adId`, with no duplicate ID.

```text
adId, adGroupId, campaignId, adName, status, primaryStatus,
type, finalUrls, displayUrl, resourceName
```

`finalUrls` is `null` or an array of at most 20 non-empty strings. The referenced Ad Group and Campaign relation must match.

### `youtubeAssets`

Maximum 5,000 rows, sorted numerically by `assetId`, with no duplicate ID.

```text
assetId, assetName, status, assetType, youtubeVideoId,
youtubeVideoTitle, resourceName
```

`assetType` must be `YOUTUBE_VIDEO`.

### `campaignDailyMetrics`

Maximum 10,000 rows, sorted by `metricDate` then numeric `externalEntityId`, with no duplicate date/entity/segment identity.

```text
metricDate, reportLevel, externalEntityId, campaignId, adGroupId, adId,
advertisingChannelType, advertisingChannelSubType, adChannel, segmentKey,
currency, spendMicros, impressions, clicks, conversions,
conversionValueMicros, videoViews, videoViewRate, averageCpvMicros
```

Rules:

- `metricDate` is `YYYY-MM-DD` in the account timezone;
- `reportLevel` is `campaign`;
- `externalEntityId` equals `campaignId`;
- `adGroupId` and `adId` are `null`;
- `segmentKey` is `all`; breakdown rows are not accepted into Canonical v1;
- `adChannel` is derived from `advertisingChannelType` and must match;
- `currency` must equal the account currency;
- money fields are non-negative safe integer micros;
- counts are non-negative safe integers or `null`;
- explicit source zero remains `0`; omitted or unsupported values remain `null`.

## Validation order

The Worker performs these gates before any Queue or Lark business write:

1. exact method/path and JSON Content-Type;
2. exact required headers and formats;
3. body byte limit;
4. SHA-256 body digest;
5. timestamp window;
6. current/previous key resolution and HMAC verification;
7. JSON parsing;
8. exact envelope/schema/identity/limits/order/relations/null semantics;
9. exact idempotency header-to-delivery match;
10. expired-state cleanup;
11. atomic nonce reservation;
12. durable delivery reservation.

Failures are closed and classified without logging the raw body or secret.

## Mode behavior

### `DRY_RUN`

Manager Script only. It selects the exact advertiser, performs read-only queries, builds the envelope and logs sanitized counts/digest prefix. It performs no HTTP request.

### `PREVIEW`

The Script sends a signed envelope with `mode=PREVIEW`. The Worker validates security, replay, schema and identity, records sanitized validation evidence, redacts the stored payload immediately and sends no Queue message or Lark business write.

### `LIVE`

Manual one-shot only. The Worker queues a reference-only job. The Sync Worker loads the payload from D1, enters the shared distributed lock/reliability runner, plans all destinations before the first write, executes stable-key upserts and reconciles every row.

## Destination and write contract

All 12 destination plans must succeed before the first write:

| Payload | Lark table | Stable key field |
|---|---|---|
| account | `RAW_Google_Ads_Accounts` | `raw_account_key` |
| campaigns | `RAW_Google_Ads_Campaigns` | `raw_campaign_key` |
| adGroups | `RAW_Google_Ads_Ad_Groups` | `raw_ad_group_key` |
| ads | `RAW_Google_Ads_Ads` | `raw_ad_key` |
| youtubeAssets | `RAW_Google_Ads_Assets` | `raw_asset_key` |
| campaignDailyMetrics | `RAW_Google_Ads_Daily` | `raw_ads_daily_key` |
| normalized account | `MKT_Ads_Accounts` | `ads_account_key` |
| normalized campaigns | `MKT_Ads_Campaigns` | `campaign_key` |
| normalized ad groups | `MKT_Ads_AdGroups` | `ad_group_key` |
| normalized ads | `MKT_Ads_Ads` | `ads_ad_key` |
| normalized YouTube assets | `MKT_Ads_Creatives` | `creative_key` |
| normalized campaign daily | `MKT_Ads_Daily` | `ads_daily_key` |

The physical Canonical key names above match the already-applied Lark Base. Historical blueprint aliases such as `ads_campaign_key`, `ads_ad_group_key` and `ads_creative_key` are not used by this connector's physical write plan.

The connector does not change Lark Formula, View or schema. Money source fields remain integer micros; display values and approved formulas retain their existing ownership.

## Retry, lock, DLQ and reconciliation

- Manager Script transport attempts: at most 3, retrying network failure, HTTP 429 and HTTP 5xx with 1/2/4-second exponential delays; each retry uses a fresh nonce and timestamp but the same body, delivery ID, idempotency key and digest.
- Worker/Queue processing reuses the shared retry classification and Queue backoff.
- D1/infrastructure/source rate-limit failures are retryable.
- Invalid signature/schema/identity/replay/payload relation and reconciliation mismatch are permanent.
- The shared distributed lock uses customer/profile/account/platform/source/sync type identity and is renewed during processing.
- A permanent Queue failure marks the Google delivery terminal before shared DLQ persistence.
- Controlled redrive can reuse the retained delivery payload while it remains inside retention.
- Each table result must satisfy `created + updated + skipped = expected` and `duplicateInputRows = 0`.
- Successful rerun is stable-key idempotent and must not create duplicate records.

## D1 states and retention

Delivery states:

```text
reserved → preview_validated
reserved/queue_failed → queued → processing → completed
processing → failed_retryable → processing
processing → failed_permanent
```

The processing transition also accepts `reserved`, `queue_failed` and `queued` to recover a Queue-send/D1-mark race.

Retention:

- nonce rows: 600 seconds;
- application redrive/access window for the raw signed payload: 7 days;
- PREVIEW and completed payloads: redacted immediately to `{}`;
- failed payloads: usable only inside the 7-day redrive/investigation window;
- the first ingress sweep or delivery read after expiry redacts stale payload and blocks redrive fail-closed;
- no new cleanup schedule is introduced, so the physical sweep is activity-driven rather than a wall-clock deletion guarantee;
- terminal audit row: eligible for deletion 30 days after the last update during the next ingress sweep.

## Rollout boundary

- Connector flag: `MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false` by default.
- No `MKT_SCHEDULE_GOOGLE_ADS_ENABLED` setting exists.
- No Google Ads cron job exists.
- Customer-real UAT reuses the existing developer DEV Worker, D1, Queue, DLQ, secret store and Lark resources with `MKT_ENV=development` and profile `uat_chemistry_k`.
- No separate UAT infrastructure is created; only the authorized source account/data and logical profile change.
- Production remains isolated and customer-owned.
- Production remains blocked until customer-real reliability/idempotency/reconciliation UAT and ownership gates pass.
