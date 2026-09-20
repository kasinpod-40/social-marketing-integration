# Organic and Paid Ads period comparison — 2026-09-19

## Scope boundary

This contract applies only to the Organic and Paid Ads comparison output of the exact Customer Base
`✨Marketing Content Calendar` under `Social MKT Data Hub`. It does not authorize access to another Lark folder
or Base, Dashboard Block mutation, deployment, Queue admission, schedule changes or Production execution.

## Organic comparison contract

- Account/report KPI totals continue to calculate period movement across all tracked Content observations.
- Top Content is a separate presentation projection. A row is eligible only when its canonical
  `MKT_Content.published_at` date falls inside the selected inclusive period.
- A 3D selection therefore compares only posts published on those three reporting dates; older posts are not
  retained in the comparison merely because their cumulative counters changed during the period.
- D1 remains the metric/ranking authority. After D1 ranks the eligible rows, the runtime reads only their bounded
  `content_key` identities from `MKT_Content` to hydrate `caption`, `content_url` and `thumbnail_url`.
- A missing publication date is not sufficient evidence that a post belongs to the selected period and is excluded
  from Top Content. It does not remove the row from account/report KPI calculation.

## Engagement contract

- Facebook, Instagram and TikTok Engagement remains `Likes + Comments + Shares` with existing null/coverage rules.
- YouTube Data API does not expose video share count. YouTube Engagement v2 is therefore the observable definition
  `Likes + Comments`; `period_shares` and `latest_total_shares` remain `null`/N/A and are never converted to zero.
- The YouTube report identity uses `youtube-organic-v2` so retained v1 materializations cannot be mistaken for the
  changed metric definition.

## Paid Ads comparison contract

- Ad inclusion is determined by canonical `ads_daily_facts` activity inside the selected inclusive period.
- Current entity status is not an inclusion filter. An Ad that is paused or stopped now remains eligible when it
  had spend/impressions/clicks/conversions in the selected period.
- Additive fields are summed first. CTR, CPC, CPM, CPA, conversion rate and ROAS are then derived from the aggregate;
  daily rates are never averaged.
- D1 remains metric/ranking authority. The bounded ranked `ads_ad_key` identities are read from `MKT_Ads_Ads` only
  to hydrate `ad_name`.
- Google Ads has reviewed Campaign-grain performance facts only. The shared Paid Ads ranking exposes Google as
  Top Campaigns with `external_campaign_id` and a null `external_ad_id`; no Ad identity is fabricated from the
  Campaign-grain source.

## Lark presentation

No new Lark table or Field is required. Organic comparison remains in `MKT_Report_Top_Content`; paid ranked Clicks
are mirrored into `MKT_Report_Metric_Values` so Channel and Period can apply without a fixed 1D/3D/7D/30D filter.
Period Multi-source uses the identical Single Select field `__mkt_legacy_window_days_single_select_v1` in Metric
Values, Top Content and Top Ads; Channel Multi-source uses `platform`. Pairing Period to `platform` is invalid.
After separate explicit live-apply authorization, the existing Paid Ads block
`🏆 คลิกตามโฆษณาและแคมเปญ` was updated in place as a full-width bar chart grouped by Platform and Ad/Campaign name.
`MKT_Report_Top_Ads` remains the detailed ranked-row/readback table.

Suggested Thai block names:

- `เปรียบเทียบคอนเทนต์ที่เผยแพร่ในช่วงเวลาที่เลือก`
- `เปรียบเทียบโฆษณาที่มีผลงานในช่วงเวลาที่เลือก`

The Paid chart filters exact Customer profile, dashboard report type, ranked-click metric identity, available rows,
non-empty names and positive Clicks. Channel and Period are supplied by the existing dashboard slicers. Use
`caption` as the Organic category label and the hydrated Ad/Campaign display name as the Paid category label.

## Verification

- focused Organic/Ads tests: 24/24 pass;
- full Node tests: 3,407/3,407 pass;
- Workers-runtime tests: 18/18 pass;
- Report reliability: 106/106 pass;
- architecture/hygiene, zero-vulnerability audit, deploy dry-run and diff whitespace check pass.

The separately authorized live completion is Worker version `4620eab2-c3e5-489e-8743-b2ba293bf952`, eight serial
Meta/Google 1D/3D/7D/30D materializations for period end `2026-09-19`, and exact Lark API readback with both
platforms, zero foreign-profile rows and zero missing names. Focused final regression is 34/34.
