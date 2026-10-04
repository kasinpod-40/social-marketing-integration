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

## Verified full inventory / remaining identity gate — 2026-10-04

GET-only STATUS_ALL proof: 228 Campaigns, 261 Ad Groups, 5,771 Ad endpoint identities.
All pages reconciled (3/3/58); bounded concurrency four avoids serial wait expiry and preserves
consistent totals, duplicate/owner guards. Complete hierarchy read found zero missing Campaign /
Ad Group parents and zero inconsistent Campaign parents. No business rows were written.

There are 1,062 distinct video IDs and 2,414 image IDs, no cross-type ID collision; 821 Ads have
no video/image and 4,923 have multiple source asset IDs. Image IDs may be covers; these counts
cannot justify choosing the first asset, generating a creative ID, or interpreting every Ad
endpoint identity as the upgraded Smart+ Ad ID. Automation/Smart+ and source asset types must
be proved before admitting those master/fact writes. Individual complete_payment and
complete_payment_roas requests succeeded; the value hypothesis failed. Metric semantics,
missing-row/zero behavior and attribution remain unapproved from field presence alone.

## Smart+ identity proof — 2026-10-04

Campaign automation classification is complete: 146 MANUAL / 1 SMART_PLUS / 81 UPGRADED_SMART_PLUS,
no unknown. Smart+ endpoint full STATUS_ALL inventory: 356 true Ad IDs, four pages, 680 creative
entries, 679 usable smart_plus_creative_id references, one missing/invalid reference. Missing references
must remain unavailable; no title/position/generated Creative key is permitted. Before writes,
join these IDs to the legacy Ad endpoint and verify Campaign/Ad Group parents. Reports use a single
chosen identity dimension: ad_id_v2 for true Ads, legacy ad_id for upgraded Creative grain. Never
combine both as Ads or sum them. Account, Campaign, Ad and Creative grains remain alternatives.

Independent field probes accept total_purchase_value and value_per_complete_payment; they reject
complete_payment_value. Event definition, attribution, missing-row behavior, currency and arithmetic
consistency are still required before metric mapping. GET-only source presence does not admit writes.
Official [Smart+ Ad endpoint and query fields](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AdApi.md#smartPlusAdGet)
and [filter](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/FilteringSmartPlusAdGet.md).

Full cross-endpoint proof passed: all 679 usable Smart+ creative references match legacy Ad endpoint
identities with the same Campaign/Ad Group; zero missing/conflicting parent and zero shared Creative
ownership. The 5,771 legacy endpoint rows split into 5,049 upgraded Creative identities and 722
Manual/Legacy Ad identities. The 356 Smart+ Ad IDs are separate. Canonical master implementation
must preserve this partition; every unavailable Creative reference remains null/unavailable.

## Master write contract — authorized implementation 2026-10-04

ใช้ full STATUS_ALL snapshot ที่ผ่าน proof ก่อนเขียน: Account / Campaign / Ad Group และ
Ad แบบ Manual/Legacy แยกจาก true Smart+ Ads; legacy endpoint ของ Upgraded Smart+ เป็น
Creative เท่านั้น ใช้ source ID เดิม ไม่เลือก first asset หรือสร้าง ID ใหม่

- D1 ads_entity_state และ Lark master ห้าตารางเดิม; customer/account/advertiser exact scope
- Campaign automation ไม่มี unknown; ตรวจทุก parent ก่อนทำ plan หรือ writes
- Creative ของ Upgraded Smart+ ใช้ legacy creative ID ทั้ง inventory; parent_ad_id ตั้งได้เฉพาะ
  reference ที่มีจริงใน Smart+ creative_list; orphan ไม่อนุมาน parent และไม่ถือว่าเป็น Ad
- Manual/Legacy ที่มี video_id ใช้ source video ID เป็น reusable video Creative; image_ids
  ยังไม่แยก cover/image จึงไม่สร้าง Creative จาก image_ids ในขั้นนี้ ค่า Creative ref ที่ไม่ทราบเป็น null
- Ads ที่มีหลาย Creative ไม่เลือกตัวแรก; external_creative_id เป็น null พร้อมคง relation ที่ D1
  Creative parent_ad_id เมื่อ source พิสูจน์ได้; ข้อมูล source ที่ไม่มี ID ไม่สร้าง placeholder
- ใช้ canonical status active/paused/removed/unknown, currency/timezone จาก advertiser ที่validated
- ไม่ลบ master ที่ไม่คืนมา; preserve first_seen/created และ Daily Coverage เดิมของ existing master
- พรีวิวต้องผ่าน schema/capacity และทุกตาราง plan ก่อนเขียน; batch ไม่เกิน100, renewable lease,
  audit log, D1 fields readback และ Lark zero-diff readback; replayไม่เปลี่ยนข้อมูลเดิม
- ช่วงนี้ไม่เขียน Daily/Conversion/Report/Summary/Schedule; เป็น master slice ของงานครบระบบ

## Verified STATUS_ALL daily grain base contract — 2026-10-04

Full GET Campaign/ad_id_v2 reports passed 2025-09-01, 2026-01-01, 2026-06-01 and 2026-10-03.
Every source identity matched the stored true master and Campaign/Ad Group parents; spend in integer
micros, impressions and clicks sums match exactly between independent grains on every date.
Approved next implementation: independent Campaign/ad D1 facts; exact day/grain coverage, readback,
replay and existing-fact reconciliation. Campaign coverage keeps `ads_daily_facts` for compatibility;
Ad coverage uses `ads_daily_facts_ad`, never shares a Campaign coverage completion marker.
Campaign/Ad rows are alternatives, never summed together. Existing Campaign-only queries must explicitly
filter report_level before any mixed-grain write. Base proof does not admit new conversion/value/reach
metrics or activate Report/schedule; those need their own semantics/source proof and downstream UAT.

Official [core/optimization conversion semantics](https://ads.tiktok.com/help/article/basic-data):
conversions follow the selected optimization event; reach counts distinct users. Generic optimization
conversion is not purchase, and entity/day reach cannot be summed as distinct period audience.

## Full true Ad metric observation — 2026-10-04

Full STATUS_ALL ad_id_v2 days2025-09-01 and2026-10-03 proved base/delivery/video/optimization/
web-purchase identical complete identities53/35, every requested metric numeric. Generic conversion
nonzero12/6 Ad rows; complete_payment, complete_payment_roas, value_per_complete_payment explicitly
zero everywhere. Generic conversion follows optimization event and remains distinct from purchase.
App purchase family rows40/30 do not cover all53/35 Ads; missing rows are unavailable. Do not
combine app purchase value with web payment count/ROAS or derive exact value from rounded ratios.
Metric observation does not prove current/historical attribution windows or full date coverage.


## Source post Creative contract — 2026-10-04

GET inventory proves tiktok_item_id present for every509SINGLE_VIDEOwithoutvideo_id and37CAROUSEL_ADS
withoutimage_ids. Preserve existing video-resource identities; otherwise use exact numeric sourcepostID
for proved format. Sharedpost creates one reusable Creative with null Campaign/AdGroup/Ad parents;
Ads retain their own proved parent and Creative reference. Lark source_content_id holds postID,
creative_type video/carousel already supported, video_id remains null for posts. Reject reusedpost
with conflicting format/resource semantics and any upgradedCreative namespace collision before writes.
Current post reference never becomes historical Daily Creative attribution. Unknownformat/noID staysnull.


## Proved core Daily metric mapping — 2026-10-04

Officialdefinitions and exactfourdate Campaign/ad_id_v2 reconciliation admit source core fields:
reach is distinctusers perentity/day only; conversion is provider-selectedoptimizationevent count,
not purchase or a named historical event. video_play_actions maps video_views (playstarts/replayexcluded).
video_watched_2s/6s preserved in actions_json with exactprovidermetricnames and semantics.
No inferredattributionwindow, purchasevalue, complete-payment value or eventfact from genericconversion.
Conversion count supports nonnegative decimals; missing/nonnumeric fields reject wholeday under coremode.
Existing spend/impressions/clicks keys remain unchanged, all core fields participate in fingerprint,
allfieldreadback/replay. Separate core metricwriteflag; base writes refuse downgrading enrichedfacts.
Lark Daily uses proved dayreach/conversion/video only; Report/TopAds periodreach remainsnull (nonadditive).
Ratio video_views/impressions uses aggregatecomponents; unavailable currencyvalue staysnull.
Historical whole-date source preflight must pass before authorized enrichment backfill.
Officialreferences: https://ads.tiktok.com/resources/help/article/basic-data and
https://ads.tiktok.com/resources/help/article/video-play .
