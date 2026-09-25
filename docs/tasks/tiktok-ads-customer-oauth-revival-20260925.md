# TikTok Ads Customer OAuth revival — 2026-09-25

## Boundary

This work starts from current `main@85e3ba76` and does not reuse the stale PR #220 branch history.
It reuses the existing Customer Connection OAuth v2 invitation/state authority, AES-256-GCM encrypted
Refresh Token repository, D1 connection store and HTTP composition.

## Phase A

- add `tiktok_ads` only to the shared Customer Connection contract;
- use TikTok API for Business v1.3 authorization/code exchange;
- discover authorized advertiser accounts and validate exact advertiser info read-only;
- persist only the Refresh Token through the existing encrypted credential repository;
- keep Queue, Ads facts, Lark, Report, AI and Schedule side effects at zero;
- do not touch TikTok Organic or create a second OAuth/credential framework.

If the grant exposes exactly one advertiser, the callback may bind it automatically. If multiple
advertisers are returned and no exact `MKT_TIKTOK_ADS_ADVERTISER_ID` is configured, the callback fails
closed with `TIKTOK_ADS_ADVERTISER_SELECTION_REQUIRED`.

## Explicitly deferred

Provider refresh-token rotation, Campaign/Ad Group/Ad ingestion, reporting, D1 Ads writes, Lark Paid Ads
projection, Report activation and scheduling are separate reviewed phases after OAuth/read-only proof.


## Cloudflare binding-budget hotfix

Customer Production is already at the 250 text-binding ceiling. TikTok Ads therefore adds only one
new text binding: secret `TIKTOK_ADS_APP_CREDENTIALS`, containing JSON with `app_id` and `secret`.
The callback URI is derived from existing `MKT_CONNECTION_PUBLIC_ORIGIN`, and an advertiser ID is not
provisioned as a new binding for the normal single-advertiser path. This avoids three extra TikTok
bindings while preserving the existing shared OAuth/runtime contract.
