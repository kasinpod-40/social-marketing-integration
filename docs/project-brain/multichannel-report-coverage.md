# Multi-channel Report Coverage

Status: `AUDIT_COMPLETE_REVIEW_REQUIRED`

Authority task: `docs/tasks/multichannel-report-coverage-v1.md`

Branch: `audit/multichannel-report-coverage-v1`

## Locked decisions

- The Report/Dashboard source of truth is validated `report_materializations`, never detailed source facts from Dashboard code.
- The supported passed Dashboard windows are exactly `1`, `3`, `7`, `30`.
- Preserve canonical Lark window SingleSelect field `fldMlTUP3Z`, its option IDs and order.
- Preserve Display V2, Organic Dashboard formulas/layout and Data Quality Dashboard.
- Missing, unavailable or incomplete metrics remain numeric `null` with N/A availability metadata.
- Observed zero remains numeric `0`.
- New channels reuse the shared D1 readers/materializer/Lark writer/Stable keys; no channel-specific Report engine or Dashboard is allowed.
- `MKT_Metric_Definitions` seed rows, Legacy TikTok report definitions and materialized Report Metric rows are separate authorities and counts.
- 9/15/90 settings must not be written through the current four-option `MKT_Report_Metric_Values.window_days` path.
- The active Meta retained-continuation workstream owns Facebook Organic and Meta Ads until closeout.
- `Social MKT Data Hub(13).base` was unavailable during this audit; user-confirmed Base facts are locked but exact Base readback remains required.

## Current decisions by channel

```text
TikTok Organic      ALREADY_COMPLETE
YouTube Organic     READY_TO_MATERIALIZE at code level; live Coverage/Base rows unverified
Instagram Organic   SOURCE_PARTIAL / uat_pending
Facebook Organic    BLOCKED_BY_ACTIVE_WORKSTREAM
Meta Ads            BLOCKED_BY_ACTIVE_WORKSTREAM
Google Ads          SOURCE_PARTIAL / central catalogs still uat_pending
TikTok Ads          WAITING_LIVE_SOURCE / Report planned / merged Connector absent
WooCommerce         SOURCE_READY_REPORT_MISSING
Chatwoot            WAITING_LIVE_SOURCE, then SOURCE_READY_REPORT_MISSING after Final UAT
Operations          ALREADY_COMPLETE
Executive           SOURCE_PARTIAL until all category materializations pass
```

## Important gaps

1. WooCommerce collections exist in D1 materialization payloads but are not projected into Lark Dashboard rows.
2. Chatwoot has no generic Report contract, setting, adapter, calculator or output mapping.
3. Paid/Organic source status gates intentionally prevent adapters from running while `uat_pending`/`planned`.
4. Settings include 9/15/90, but the passed Metric writer accepts only 1/3/7/30.
5. Base-specific exact filter validation is pending the missing `.base` artifact/read-only Lark evidence.

## Phase order

```text
A  TikTok regression + YouTube/Instagram Organic completion
B  WooCommerce summary/settings + generic dimensioned output
C  Chatwoot after Final UAT
D  Google Ads + TikTok Ads after source readiness
E  Facebook Organic + Meta Ads after Meta closeout
F  Executive aggregates from validated materializations only
```

## Preferred generic dimension design

WooCommerce products/payment/shipping and Chatwoot agent/inbox rankings should reuse:

```text
MKT_Report_Metric_Values.dimension_type
MKT_Report_Metric_Values.dimension_value
MKT_Report_Metric_Values.rank
```

The existing `report_metric_key` already includes dimension type/value. This avoids a Woo-only or Chatwoot-only Report table and preserves universal Dashboard discovery.

## No-go rules

- no zero substitution for missing facts;
- no cross-currency totals;
- no average-of-daily-averages without weights;
- no Ads ratio before SUM;
- no detailed D1 reads from Dashboard/AI;
- no new Dashboard per platform/account;
- no change to `docs/current-task.md`;
- no access to Meta retained evidence from this workstream;
- no Remote D1/Lark/Queue/Worker/Schedule/Production action before review and separate authorization.
