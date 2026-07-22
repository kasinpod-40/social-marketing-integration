# 03 — Platform Decisions

## TikTok Organic
Use Lark TikTok For Creator Native Integration first.

Confirmed fields include video ID, published time, shares, comments, likes, duration, views, description, embed/share/thumbnail URLs, average play duration, total play duration, percentage watched completely, deduplicated viewers, traffic sources, and country/region breakdown.

## TikTok Ads
Use Lark TikTok For Business Native Integration for Campaign / Ad Group / Ad / Creative master data.

Custom TikTok Reporting API is still needed for spend, impressions, clicks, conversions, conversion value, actual ROAS, and daily breakdown.

## Google Ads
Lark Google Ads Native Integration currently exposes Customer List and Campaign List. It is useful for master/config data but not enough for performance dashboards.

For the MVP, use a customer-authorized Google Ads Manager Script with exact account allowlisting and read-only `AdsApp.search()` GAQL. This path can read daily performance without waiting for direct API Basic Access.

Direct Google Ads API / GAQL remains a Phase 2 option for scale, centralized OAuth or fields unavailable to Scripts. External delivery from the Manager Script requires a separately approved signed endpoint and must remain disabled until replay/idempotency, retention, redaction and destination-write contracts pass.

## Meta / Facebook / Instagram
Custom integration is expected for organic and ads data, subject to permissions and API access.

## YouTube Organic
Use YouTube Data API + YouTube Analytics where permissions allow.
