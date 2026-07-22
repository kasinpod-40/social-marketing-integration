# 03 — Platform Decisions

## TikTok Organic

Use Lark TikTok For Creator Native Integration first for the developer-owned DEV source.

Confirmed fields include video ID, published time, shares, comments, likes, duration, views, description, embed/share/thumbnail URLs, average play duration, total play duration, percentage watched completely, deduplicated viewers, traffic sources, and country/region breakdown.

`RAW_TikTok_Creator_Videos` remains a protected Lark Native source. Reporting uses Canonical Content/Daily tables.

## TikTok Ads

Production direction is a controlled TikTok For Business API connector through the Worker/reliability architecture, not a Lark Native production dependency.

A Lark Native integration may be used only as an explicitly approved temporary DEV comparison/source-discovery aid. It must not become the source of truth for Production spend, impressions, clicks, conversions, conversion value or ROAS.

TikTok Ads still requires:

- Business Center/advertiser authorization preflight;
- app/scopes/token lifecycle and reporting endpoint contract;
- Sandbox/test or customer-real UAT strategy;
- stable keys, pagination, rate limits and bounded extraction;
- Queue/D1/retry/DLQ/reconciliation;
- customer-owned Production resources.

## Google Ads

Lark Google Ads Native Integration exposes limited master/config data and is not sufficient for performance dashboards.

For the MVP, use a customer-authorized Google Ads Manager Script with exact account allowlisting and read-only `AdsApp.search()` GAQL. This path can read daily performance without waiting for direct API Basic Access approval.

Basic Access application was submitted on `2026-07-21`, case `1-686800040839`, and remains pending. Current developer-token level is Test Account Access.

Direct Google Ads API / GAQL remains a Phase 2 option for scale, centralized OAuth or fields unavailable to Scripts. External delivery from the Manager Script requires a separately approved signed endpoint and must remain disabled until replay/idempotency, retention, redaction and destination-write contracts pass.

## Meta / Facebook / Instagram

Use controlled custom integrations for organic and Ads data, subject to permissions and API access. Shared transport may be reused, but Page, Instagram Business and Ads identities/metrics remain separate contracts.

## YouTube Organic

Use YouTube Data API plus YouTube Analytics where permissions allow. Public resources and Owner Analytics remain separate clients/contracts, with exact identity validation and Pacific source-date semantics.

## WooCommerce and Chatwoot

Use customer-authorized API connectors with minimum-data contracts. WooCommerce source money remains decimal strings; Chatwoot excludes message bodies, email and phone from the initial operational contract.
