# 03 — Platform Decisions

## TikTok Organic
Use Lark TikTok For Creator Native Integration first.

Confirmed fields include video ID, published time, shares, comments, likes, duration, views, description, embed/share/thumbnail URLs, average play duration, total play duration, percentage watched completely, deduplicated viewers, traffic sources, and country/region breakdown.

## TikTok Ads
Use Lark TikTok For Business Native Integration for Campaign / Ad Group / Ad / Creative master data.

Custom TikTok Reporting API is still needed for spend, impressions, clicks, conversions, conversion value, actual ROAS, and daily breakdown.

## Google Ads
Lark Google Ads Native Integration currently exposes Customer List and Campaign List. It is useful for master/config data but not enough for performance dashboards.

Custom Google Ads API / GAQL is required for daily performance metrics.

## Meta / Facebook / Instagram
Custom integration is expected for organic and ads data, subject to permissions and API access.

## YouTube Organic
Use YouTube Data API + YouTube Analytics where permissions allow.
