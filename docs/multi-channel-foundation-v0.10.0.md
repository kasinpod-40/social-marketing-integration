# Multi-channel Foundation v0.10.0

## Release status

`v0.10.0-multi-channel-foundation` prepares six workstreams before external platform activation. This is a code-and-contract release, not a claim that the new connectors have passed Live DEV UAT.

| Workstream | Delivered | Runtime status |
|---|---|---|
| YouTube Organic contract + Lark Blueprint | Source contract, three RAW-table blueprints, stable keys, null semantics | `uat_pending` |
| YouTube connector foundation | Data API/Analytics client, adapter, normalization and destination planning | fail-closed; no Worker route |
| Canonical Organic pipeline | Shared identities, normalized content rows, batch isolation/dedupe, destination reconciliation | active for proven TikTok path; reusable by YouTube |
| Meta foundation | Versioned Graph client with bearer auth, bounded cursor pagination and error classification | planned; no business adapter/route |
| WooCommerce + Chatwoot | Sanitized contracts, fixtures and validators | planned; no network client/route |
| Canonical Ads model | Account/Campaign/Ad group/Creative/Daily hierarchy, keys, metrics and Lark Blueprint | planned; no API adapter/route |

## YouTube Organic contract

Public channel/video data uses YouTube Data API resources. Owner analytics uses OAuth and remains a separate period-metric source; it must not overwrite cumulative Data API snapshots.

RAW tables:

- `RAW_YouTube_Channels`
- `RAW_YouTube_Videos`
- `RAW_YouTube_Analytics_Daily`

Destination keys:

```text
account_key       = youtube:{account_key}
content_key       = youtube:{account_key}:{video_id}
content_daily_key = youtube:{account_key}:{video_id}:{metric_date}
```

Rules:

- Unsupported or absent metrics remain `null`.
- Explicit source zero remains `0`.
- Hidden subscriber count maps to `null`.
- Channel identity mismatch is permanent and blocks writes.
- Upload playlist traversal and video batches are bounded.
- Analytics daily values are period metrics; Data API statistics are cumulative snapshots.

Official contracts used during design:

- YouTube Data API `channels`, `playlistItems`, and `videos`: <https://developers.google.com/youtube/v3/docs>
- YouTube Analytics `reports.query`: <https://developers.google.com/youtube/analytics/reference/reports/query>

## Canonical Organic core

The shared layer owns only semantics proven common across TikTok and YouTube:

- `content_key` and `content_daily_key`
- normalized `MKT_Content` and cumulative `MKT_Content_Daily` rows
- row-level error isolation and stable-key dedupe
- two-table destination planning and reconciliation

Platform payload parsing, identity rules, source metrics and authentication stay in platform adapters. TikTok normalization now uses this core and its full regression suite remains green.

## Meta shared client

The shared Graph client handles only transport concerns:

- explicit API version
- bearer token header
- HTTPS-only base URL outside localhost tests
- bounded `after` cursor pagination
- transient/permanent API classification
- no access token in URLs or error details

Facebook Page and Instagram Business mappings remain separate adapters because their identities, fields, permissions and metric semantics differ.

Official design reference: <https://developers.facebook.com/docs/graph-api/results>

## WooCommerce and Chatwoot contracts

The release includes sanitized fixtures and validators before adding external clients.

- WooCommerce preserves monetary values as decimal strings at the source boundary, uses stable order IDs, and retains status/refund timestamps without customer PII.
- Chatwoot retains operational conversation/inbox/agent/status timestamps only; fixtures exclude message bodies, emails, phones and access tokens.

Official design references:

- WooCommerce REST API: <https://developer.woocommerce.com/docs/apis/rest-api/>
- Chatwoot API: <https://developers.chatwoot.com/api-reference/introduction>

## Canonical Ads model

Hierarchy:

```text
Account -> Campaign -> Ad group / Ad set -> Creative / Ad -> Daily metrics
```

Stable keys are account-scoped:

```text
entity = {platform}:{account_id}:{entity_type}:{external_entity_id}
daily  = {entity_key}:{metric_date}
```

Raw metrics are `spend`, `impressions`, `reach`, `clicks`, `conversions`, and `conversion_value`. Derived metrics are calculated centrally:

```text
CTR         = clicks / impressions
CPC         = spend / clicks
CPM         = spend / impressions * 1000
actual_roas = conversion_value / spend
```

Missing components or a zero denominator produce `null`. Target ROAS is never renamed or stored as actual ROAS. `platform` describes the API family while `ad_channel` describes the client-facing placement/channel.

## Activation gates

No new connector may become `active` until all relevant gates pass:

1. Authorized DEV asset and credentials exist outside source control.
2. Identity preflight matches the configured customer/account.
3. RAW Lark schema is reviewed and applied with real Table IDs.
4. Source payload contract is checked against live/sandbox responses.
5. Manual sync, rerun idempotency and reconciliation pass.
6. Retry, lock, DLQ and alert behavior pass through the shared reliability layer.
7. Metric definitions and null semantics are approved.
8. Scheduled activation happens only after Manual UAT.

Until then, YouTube remains `uat_pending`; Meta, WooCommerce, Chatwoot and Ads remain `planned`. No external resources were mutated by this release.
