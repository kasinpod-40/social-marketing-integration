# TikTok Ads full completion — authorized 2026-10-03

## Authority and state

The user explicitly requests complete delivery matching the other channels, including Account,
Campaign, Ad Group, Ad, Creative, Daily, Summary, Top Ads, Report/AI and automatic sync.
This supersedes the earlier Campaign-only delivery target while retaining its verified base facts.
Production OAuth is connected. Campaign history for the original default-status query is proved
for 2025-09-01..2026-10-02 (397 dates / 5,708 Campaign-day rows). Full Campaign metadata read
proved 220 source Campaigns and matched all 119 retained masters. One-day Lark UAT proved 13/13
Campaign/Daily rows and zero-change replay. Report and schedule remain unadmitted.

## Shared model / approved implementation boundaries

No new Base, raw mirror or separate reporting framework. Use the existing Paid blueprint and
existing Customer-owned credentials/resources. All data remains scoped by exact advertiser.

| Dataset | Stable identity / destination | Mapping / semantics |
| --- | --- | --- |
| Account master | shared D1 account entity / MKT_Ads_Accounts | validated advertiser ID, name, currency, timezone, source status; no credentials |
| Campaign master | existing campaign entity key / MKT_Ads_Campaigns | campaign ID, name, objective, canonical operation status; Campaign absence is not deletion |
| Ad Group master | existing ad_group entity key / MKT_Ads_Ad_Groups | ad group ID and proved Campaign parent; optimization event and attribution audited before metric use |
| Ad master | existing ad entity key / MKT_Ads_Ads | exact ad ID and proved parents; source name/status; separate Manual/Smart+ identity semantics |
| Creative master | existing creative key / MKT_Ads_Creatives | source video/image/post material identity and type; no fabricated identity for multi-asset ads |
| Daily facts | existing grain/date/none/none key / MKT_Ads_Daily cache | Account-local day, integer-micro spend, impressions/clicks; independent grain-specific Coverage |
| Event facts | ads_conversion_daily_facts | exact event/action + attribution identity; optimization conversion never relabelled as purchase |
| Campaign Summary | existing mtd key / MKT_Ads_Campaign_Summary | one chosen grain, SUM components before ratio, null unknown values |
| Reports / Top Ads | existing shared Report tables | 1/3/7/30-day windows and comparison Coverage; Top Ads uses proved Ad facts/identity only |
| Sync/alerts | existing reliability stores and tables | central catalog, stable work identity, bounded lease/retries, resumable history, partial-write recovery |

The shared blueprint's existing field types, relationships and views remain authoritative. API
schema GET must prove all selected tables before writes. Null means unavailable/not observed;
zero is used only when source explicitly reports zero. Reach/frequency are not additive across
entities or days. Generic conversion, purchase count and attributed purchase value are distinct.
ROAS requires the exact source-supported currency/value definition. A successful API response
alone does not prove metric business semantics.

## Source discovery and remaining contract gates

Use GET-only source capability probes for Ad Group/Ad metadata and one-day Campaign/Ad metrics.
Return counts/presence only. Fixed metric groups may be hypotheses until official documentation,
real source response and identity/currency/attribution validation agree. No new metric or grain
write before that mapping is recorded. Creative metadata and upgraded Smart+ joins must be
verified from the actual returned structure, not inferred from legacy fields.

Official documentation states synchronous basic reports apply STATUS_NOT_DELETE by default.
An all-status historical comparison is required before the earlier history can be called complete
for deleted objects. Preserve proved rows, compare totals/keys and reconcile differences safely.
Account/Campaign/Ad Group/Ad totals are separate alternative grains, never summed together.

## Completion order and acceptance

1. Finish Campaign metadata D1/Lark enrichment and no-change replay.
2. Prove and record full metadata/creative/event contracts, exact parents and complete pagination.
3. Run one-day multi-grain D1/Lark UAT with all-table preflight, exact readback and replay.
4. Backfill all supported daily/event facts from 2025-09-01, with resumable date/grain Coverage
   and independent source-to-D1 reconciliation; fill only the bounded 90-day Lark cache.
5. Reconcile Account/master tables, Summary, views/relationships and 1/3/7/30-day reports/Top Ads.
6. Verify configured AI using the admitted evidence and truthful metric availability.
7. Enable only the reviewed TikTok Ads source/report schedule; prove an actual automatic cycle,
   bounded retry recovery, zero duplicate stable keys and no new unresolved scoped failures.
8. Pass focused tests, Workers runtime, full check/test/reliability/audit/dry-run and record results.

No other connector, unrelated schedule, notification recipient or retention deletion is in scope.

Official references: [Reporting API](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md),
[Ad Group API](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AdgroupApi.md),
[Ad API](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AdApi.md),
[Basic report dimensions](https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443956638721).
