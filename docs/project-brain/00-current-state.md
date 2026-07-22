# 00 — Current State

## Repository baseline

- Main before correction: `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- Active correction branch: `work/repository-closeout-corrections`
- Authoritative task: `docs/current-task.md`
- Application package version: `0.11.0`
- v0.13.x labels are schema/contract/tool revisions.
- Production: disabled.

## Lark DEV state

- Tables / Fields / Views: `42 / 737 / 133`
- Duplicate table names: `0`
- Table emoji/folder placement: `42/42`
- View emoji names: `133/133`
- Formula fields: `4/4`
- Shared-table managed filters: `17/17`
- Report managed Views: `6/6`
- Google Ads managed filters: `19/19`
- Filtered Views: `42`
- Sorted Views: `6`
- Views with hidden fields: `7`
- Google RAW tables/fields: `13/13`, `208/208`
- Canonical Ads core: `63/63`
- Relations/View shells: `12/12`, `19/19`
- New Google tables containing Records: `0`

The 133 Views consist of 17 shared managed, 6 report managed, 19 Google managed, 36 All/default and 55 legacy specialized preservation Views. The 55 legacy specialized Views do not yet have approved business logic.

## Active DEV connectors

### TikTok Organic

- Lark Native protected source.
- Canonical Content/Daily flow.
- Stable keys, idempotency and reconciliation.
- Queue, D1 lock/checkpoint, retry/DLQ/alerts.
- Daily/Weekly reports and DEV schedules.

### YouTube Organic

- Data API and Owner Analytics.
- RAW and Canonical writes.
- Resumable large-account foundation.
- Reliability/outbox/redrive migrations applied in DEV.
- DEV schedules active; customer-scale Live UAT and Production remain pending.

## Planned connectors

- Facebook Organic
- Instagram Organic
- Meta Ads
- Google Ads signed delivery
- TikTok Ads
- WooCommerce
- Chatwoot

## Google Ads state

### Access

- Chemistry K link/selectability: pass.
- Advertiser enabled and selectable under the intended manager.
- Basic Access application submitted `2026-07-21`.
- Case ID `1-686800040839`.
- Cloud project `788131774873`.
- Review pending; current developer-token level is Test Account Access.

### Read-only Manager Script UAT

- Exact advertiser allowlist passed.
- Read-only GAQL through `AdsManagerApp` and `AdsApp.search()`.
- Six bounded datasets succeeded and were non-empty.
- Errors/truncation `0/0`.
- Google Ads changes: `No changes`.
- Frequency `—`; no schedule.
- No external delivery or destination writes.

### Missing end-to-end path

- Google Ads connector catalog/feature flag.
- signed ingress route and schema version.
- HMAC/timestamp/nonce/replay validation.
- Queue job/router and D1 idempotency/checkpoint state.
- six-dataset normalization and Lark writers.
- partial failure, retry, reconciliation, retention and redaction.
- isolated UAT and schedule activation.

## Safety correction

Google Ads View Filter Apply is update-only. Missing managed Views or any non-`update_view` action must block with `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`.

## Progress estimate

- Lark data model and managed presentation: `100%`
- TikTok Organic: `95%`
- YouTube Organic: `90%`
- Facebook Organic: `30%`
- Instagram Organic: `30%`
- Meta Ads: `25%`
- Google Ads end-to-end: `45%`
- TikTok Ads: `10%`
- WooCommerce: `10%`
- Chatwoot: `10%`
- MKT DEV MVP: approximately `59%`
- Chemistry K Production readiness: approximately `25%`

## Next task

After the correction PR passes all repository gates, open:

`Google Ads Manager Script signed delivery connector`

Schedule and Production remain disabled until the signed delivery and reliability path passes isolated UAT.
