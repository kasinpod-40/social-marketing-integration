# Multi-channel Report Coverage Audit & Metric Matrix v1

Status: `AUDIT_COMPLETE_REVIEW_REQUIRED`

Branch: `audit/multichannel-report-coverage-v1`

Audit base: `main@65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f`

Audit mode: `READ_ONLY_REPOSITORY_AUDIT_AND_CONTRACT_PLANNING`

## Safety result

```text
Remote D1 query/write/migration     0
Remote Lark read/write/schema       0
Provider request/replay             0
Queue/DLQ message                   0
Worker deployment                   0
Schedule/Cron activation            0
Production change                   0
docs/current-task.md modification   0
Meta retained-evidence access       0
```

The workstream created only this branch and new audit documentation. It does not authorize Connector implementation, Live backfill, Report generation, Lark Apply, D1 mutation or merge.

## Evidence boundary

The requested file `Social MKT Data Hub(13).base` was not available through the current conversation file sources or the repository. Therefore:

- the user-confirmed Live Base facts below are accepted as the locked operational baseline;
- repository-to-Base field IDs, option IDs, block filters and exact record contents were not independently re-read;
- any item marked `BASE_READBACK_REQUIRED` must be verified from that exact Base file or a separately authorized read-only Lark metadata/data audit before implementation;
- no Base-specific value is guessed.

Locked user-confirmed baseline:

```text
🌱 Organic Performance                 displaying
🛡️ Data Quality & Operations           displaying
Display V2 Dashboard records           68 / 68
MKT_Report_Metric_Values records        86
current_value=null / N/A records        24
window selector order                  1 → 3 → 7 → 30
canonical window field                 fldMlTUP3Z
Display V2 / Window / Organic formula  frozen
Data Quality Dashboard                 frozen
```

## Executive findings

1. The shared Report runtime already supports platform-neutral materialization for four Organic platforms, three Paid Ads platforms and WooCommerce. It reuses `report_materializations`, Shared Reliability, D1 readers and the existing Lark writer.
2. TikTok Organic is the only channel proven end-to-end at the locked Dashboard state: 17 client-visible metrics × 4 windows = 68 Dashboard rows.
3. Operations/Data Quality is already displaying and is out of implementation scope except for regression protection.
4. YouTube is code-active in both Connector and Report catalogs and has the generic D1/Report/Lark path. Its exact live D1 date coverage and Base materializations remain unverified.
5. Instagram has generic Report code and settings, but both Connector and Report catalogs remain `uat_pending`; it cannot be treated as complete.
6. Facebook Organic and Meta Ads are owned by the active Meta retained-continuation workstream and are blocked from implementation here.
7. Google Ads has source/runtime history in the repository, but the current central Connector and Report catalogs still classify it `uat_pending`. The generic Report runtime intentionally returns `source_unavailable` until that status is promoted by the source workstream.
8. TikTok Ads is `planned` in the Report catalog and is absent from the merged central Connector catalog. Draft PR #220 contains connection-readiness work only and is not a reporting source.
9. WooCommerce is `active`, has D1 report readers, 13 summary metrics and discovered collections. The Lark writer currently writes only summary metrics; it does not project `top_products`, `payment_methods` or `shipping_methods` into a Dashboard-readable table.
10. Chatwoot has 14 D1 state/fact tables and 15 Lark sinks, but it has no merged generic Report platform contract, Report settings, materializer adapter or Lark dimensioned-output mapping.
11. Source Report settings currently define 66 rows: two TikTok compatibility settings plus eight scopes × seven rolling presets plus Custom. The locked Base count previously associated with the seven-scope set is 58. This strongly suggests that the eight WooCommerce settings have not been reconciled to the Base, but this is an inference pending Base readback.
12. The Report settings source still includes 9/15/90-day presets, while `MKT_Report_Metric_Values.window_days` and the passed Dashboard slicer accept only `1`, `3`, `7`, `30`. Sending 9/15/90 to the current Lark metric writer fails closed. These periods must not be added to the passed Dashboard selector.
13. Three metric authorities coexist and must not be conflated:
    - 68 deterministic rows in `MKT_Metric_Definitions` seed;
    - 13 required Legacy TikTok report definitions;
    - 17 generic client-visible Organic Dashboard metrics per materialization.
    The user-confirmed 86 rows are materialized Report Metric records, not the definition count.

## Source and Report authority map

| Layer | Authority |
|---|---|
| Source readiness | `packages/config/src/connector-catalog.js` plus source-specific UAT evidence |
| Report source readiness | `packages/application/src/reports/report-platform-adapter-registry.js` |
| Organic historical facts | `organic_content_state`, `organic_content_observations`, `organic_account_daily_facts` |
| Paid Ads historical facts | `ads_entity_state`, `ads_daily_facts`, `ads_conversion_daily_facts` |
| WooCommerce historical facts | `commerce_*` state/daily fact tables and Coverage |
| Chatwoot historical facts | `chatwoot_*_state`, `chatwoot_*_facts`, `chatwoot_reporting_event_facts` |
| Coverage | `data_coverage_runs`, `data_coverage_entities` |
| D1 Report output | `report_materializations`, `report_requests` |
| Lark Report output | `MKT_Report_Snapshots`, `MKT_Report_Metric_Values`, `MKT_Report_Top_Content`, `MKT_Report_Top_Ads` |
| Dashboard dimensions | `customer_key`, `customer_profile`, `platform`, `capability`, `account_id`, `period_kind`, `window_days`, `report_setting_key`, `metric_scope` |
| Stable keys | `report_id`, `report_metric_key`, `report_content_key`, `report_ad_key` |
| Missing-value contract | unknown/unavailable/incomplete = numeric `null` + N/A metadata; observed zero = `0` |

## Current coverage matrix

`report_window=1|3|7|30` means four independent inclusive rolling materializations. Exact earliest/latest source dates are `BASE_D1_READBACK_REQUIRED` unless explicitly stated otherwise.

| dashboard_page | dashboard_block | channel | capability | metric_key | display_name | source_table | source_field/formula | aggregation | report_window | null_semantics | source_readiness | report_setting_status | materializer_status | D1_status | Lark_status | dashboard_filter_status | blocker | recommended_phase | coverage_status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 🌱 Organic Performance | Period KPIs | TikTok Organic | organic | `tiktok:period_*` | Views/Likes/Comments/Shares/Engagement/Rate | `organic_content_observations` | end cumulative − pre-period baseline; new content baseline 0 | strict sum then derived rate | 1\|3\|7\|30 | any required unknown or old-content baseline gap => null/N/A | active and proven | existing | complete | materialized | 68/68 locked rows | exact passed filters; frozen | none | A regression only | ALREADY_COMPLETE |
| 🌱 Organic Performance | Current totals | TikTok Organic | organic | `tiktok:latest_total_*` | Total Views/Likes/Comments/Shares/Engagement/Rate | `organic_content_observations` | latest observed cumulative values | strict latest sum then rate | 1\|3\|7\|30 | unknown contributor => null; observed zero remains 0 | active and proven | existing | complete | materialized | locked | exact passed filters; frozen | none | A regression only | ALREADY_COMPLETE |
| 🌱 Organic Performance | Data readiness | TikTok Organic | organic | `tiktok:new_content_count`, `tracked_content_count`, `baseline_*` | New/Tracked/Baseline coverage | observations + Coverage | count distinct and coverage ratio | count/ratio | 1\|3\|7\|30 | no tracked rows => null coverage; incomplete => N/A metadata | active and proven | existing | complete | materialized | locked | exact passed filters; frozen | none | A regression only | ALREADY_COMPLETE |
| 🌱 Organic Performance | Period KPIs | YouTube Organic | organic | `youtube:period_*` | Organic period metrics | `organic_content_observations` | shared cumulative baseline contract | strict sum then rate | 1\|3\|7\|30 | preserve null/N/A | Connector active; Report active; live range unverified | source-defined | implemented | schema/path ready; facts unverified | writer ready; rows unverified | generic filters valid after rows exist | exact D1 Coverage/date range and Base materializations not read back | A | READY_TO_MATERIALIZE |
| 🌱 Organic Performance | Current totals + readiness | YouTube Organic | organic | `youtube:latest_total_*`, `youtube:baseline_*` | Current totals and readiness | observations + Coverage | shared Organic formulas | latest/count/ratio | 1\|3\|7\|30 | preserve null/N/A | same | source-defined | implemented | same | same | valid after materialization | source watermark and 4-window parity required | A | READY_TO_MATERIALIZE |
| 🌱 Organic Performance | Period KPIs | Instagram Organic | organic | `instagram:period_*` | Organic period metrics | `organic_content_observations` | shared cumulative baseline contract | strict sum then rate | 1\|3\|7\|30 | preserve null/N/A | Connector `uat_pending`; Report `uat_pending` | source-defined | implemented but intentionally gated | generic schema ready; live history unverified | writer ready | filters can match only after status promotion and rows | D1 historical Coverage/UAT and catalog promotion | A | SOURCE_PARTIAL |
| 🌱 Organic Performance | Current totals + readiness | Instagram Organic | organic | `instagram:latest_total_*`, `instagram:baseline_*` | Current totals and readiness | observations + Coverage | shared Organic formulas | latest/count/ratio | 1\|3\|7\|30 | preserve null/N/A | same | source-defined | gated | same | same | no match today | same | A | SOURCE_PARTIAL |
| 🌱 Organic Performance | All Organic blocks | Facebook Organic | organic | `facebook:*` | Organic metrics | generic Organic facts after Meta continuation | shared Organic formulas | shared | 1\|3\|7\|30 | preserve null/N/A | Report `uat_pending`; active Meta owner | source-defined | implemented but gated | continuation-owned | writer ready | no authorized refresh in this workstream | active retained continuation | E | BLOCKED_BY_ACTIVE_WORKSTREAM |
| 💰 Paid Ads Performance | KPI cards | Meta Ads | paid_ads | `meta_ads:*` 14 generic Ads metrics | Spend, delivery, conversion and video metrics | `ads_daily_facts` | SUM one account level before rates | sum/derived | 1\|3\|7\|30 | any required unknown => null; covered empty => null + no_data_confirmed | `uat_pending`; active Meta owner | source-defined | implemented but gated | continuation-owned | writer/top-ads ready | no authorized refresh | active retained continuation | E | BLOCKED_BY_ACTIVE_WORKSTREAM |
| 💰 Paid Ads Performance | KPI cards + Top Ads | Google Ads | paid_ads | `google_ads:*` 14 generic Ads metrics | Spend, impressions, reach, clicks, conversions, value, CTR, CVR, CPC, CPM, CPA, ROAS, video views/rate | `ads_daily_facts`, `ads_entity_state` | account-level SUM; ad-level ranking | sum/derived/rank | 1\|3\|7\|30 | preserve null/N/A | source history exists; Connector and Report still `uat_pending` | source-defined | implemented but gated | schema ready; exact live facts/range unverified | writer/top-ads ready | no KPI rows while source remains unavailable | catalog promotion and Coverage proof | D | SOURCE_PARTIAL |
| 💰 Paid Ads Performance | KPI cards + Top Ads | TikTok Ads | paid_ads | `tiktok_ads:*` 14 generic Ads metrics | Generic Ads metrics | planned `ads_daily_facts` | shared Ads contract | sum/derived/rank | 1\|3\|7\|30 | preserve null/N/A | Report `planned`; merged Connector absent | source-defined | implemented generic adapter but source blocked | shared tables exist; no approved source facts | writer ready | filters cannot match metric rows | customer app/advertiser access, merged source connector, D1/Coverage UAT | D | WAITING_LIVE_SOURCE |
| 🛒 Commerce & Conversion | KPI cards | WooCommerce | commerce | `woocommerce:*` 13 summary metrics | Sales, refunds, discounts, shipping, tax, order states, quantity | `commerce_daily_sales_facts` | period totals from D1 commerce report source | sum/delta | 1\|3\|7\|30 | preserve null; no-data confirmed is not zero | Connector active; Report active | eight source settings defined; Base likely unreconciled | implemented | reader and materializer ready | summary writer ready; rows unverified | no match until settings/materializations exist | exact Base settings and 4-window rows | B | SOURCE_READY_REPORT_MISSING |
| 🛒 Commerce & Conversion | Ranking collections | WooCommerce | commerce | `woocommerce:product_*`, `payment_method_*`, `shipping_method_*` | Top products/payment/shipping | materialization `collections` from commerce facts/order state | deterministic rank | sum/rank | 1\|3\|7\|30 | unknown amounts remain null | source active | same | payload implemented | collections persisted in D1 payload | **not projected by current Lark writer** | ranking blocks cannot match | missing generic dimensioned Lark output | B | FILTER_INVALID |
| 💬 Customer Service & Leads | KPI cards | Chatwoot | customer_service | proposed `chatwoot:period_*`, `chatwoot:current_*`, `chatwoot:avg_*` | Conversation/message/service-time metrics | `chatwoot_account_daily_facts`, `chatwoot_reporting_event_facts` | direct sums/latest; event-weighted averages only | sum/latest/weighted average | 1\|3\|7\|30 | missing duration sample => null; never average daily averages without weights | Connector `uat_pending`; Final UAT not proven closed in this audit | absent | absent | 14 D1 tables exist; exact live range pending | 15 source sinks exist; Report output absent | capability filter has no Report metric rows | Final UAT plus Report contract | C | WAITING_LIVE_SOURCE |
| 💬 Customer Service & Leads | Agent/Inbox rankings | Chatwoot | customer_service | proposed dimensioned Chatwoot metrics | Agent/Inbox workload and response metrics | `chatwoot_agent_daily_facts`, `chatwoot_inbox_daily_facts` | explicit dimension + stable value + rank | sum/weighted/rank | 1\|3\|7\|30 | incomplete dimension coverage => null/N/A | same | absent | absent | tables exist | no dimensioned Report output | ranking filters cannot match | generic dimensioned metric-row support missing | C | SOURCE_READY_REPORT_MISSING |
| 📊 Executive Marketing Overview | Cross-capability summary | All channels | executive | proposed safe aggregate metrics only | Channel readiness, paid totals, commerce, service | validated `report_materializations` only | aggregate completed materializations; never read detailed facts | guarded sum/count | 1\|3\|7\|30 | incomplete source category => null/N/A with coverage | downstream-dependent | absent | absent | materializations incomplete | absent | filters have incomplete category set | Phases A-E incomplete | F | SOURCE_PARTIAL |
| 🛡️ Data Quality & Operations | Freshness/Coverage/Status | Operations | operations | existing Report snapshot/Coverage fields | Freshness, Coverage, data status | Report snapshots + Coverage | latest operational state | latest/count/status | existing | preserve null; observed zero only when explicitly counted | displaying | existing | existing | existing | displaying | exact passed filters; frozen | none; Base exact readback unavailable | regression only | ALREADY_COMPLETE |
| 🛡️ Data Quality & Operations | Sync/Alerts | Reliability, Sync Runs, Alerts | operations | existing operational rows | Connector health and alerts | Shared Reliability/Sync/Alert stores | latest/open counts | latest/count | existing | absence is not synthetic zero unless query proves empty | displaying per locked baseline | existing | existing | existing | displaying | frozen | do not redesign in this audit | regression only | ALREADY_COMPLETE |

## Existing metric inventories

### A. `MKT_Metric_Definitions` deterministic seed: 68 rows

```text
Organic common snapshot definitions:
  4 platforms × 5 = 20
  views, likes, comments, shares, engagement

Additional Organic definitions:
  facebook:reach
  instagram:reach
  tiktok:unique_viewers
  tiktok:avg_watch_time_seconds
  tiktok:completion_rate
  = 5

Legacy TikTok report definitions:
  13

Paid Ads definitions:
  3 platforms × 10 = 30
  spend, impressions, reach, clicks, ctr, cpc, cpm,
  conversions, conversion_value, actual_roas

Total = 20 + 5 + 13 + 30 = 68
```

These definitions are not the same table/count as materialized `MKT_Report_Metric_Values`.

### B. Generic Organic Dashboard payload: 17 client-visible metrics per channel/window

```text
period_delta:
  period_views
  period_likes
  period_comments
  period_shares
  period_engagement
  period_engagement_rate

current_total:
  latest_total_views
  latest_total_likes
  latest_total_comments
  latest_total_shares
  latest_total_engagement
  latest_engagement_rate

data_quality:
  new_content_count
  tracked_content_count
  baseline_covered_content_count
  baseline_missing_content_count
  baseline_coverage_rate
```

### C. Generic Paid Ads payload: 14 metrics per channel/window

```text
spend_micros
impressions
reach
clicks
conversions
conversion_value_micros
ctr
conversion_rate
cpc_micros
cpm_micros
cpa_micros
roas
video_views
video_view_rate
```

### D. WooCommerce summary payload: 13 metrics per window

```text
net_sales_micros
gross_sales_micros
recognized_revenue_micros
refund_micros
discount_micros
shipping_micros
tax_micros
recognized_orders
provisional_orders
cancelled_orders
failed_orders
refunded_orders
quantity_total
```

Collections already present in the D1 materialization payload:

```text
top_products
payment_methods
shipping_methods
commerce_context
```

### E. Locked current Lark Report Metric records

The user-confirmed Base contains 86 `MKT_Report_Metric_Values` records, including 24 `current_value=null` / N/A records. Their exact key list cannot be independently reproduced without the requested Base file. They must not be deleted, rewritten to zero or used as evidence that every channel is materialized.

## Missing metrics and contracts

### Organic

- YouTube: 17 × four window rows are code-supported but live materialization/parity is unverified.
- Instagram: 17 × four window rows require source/UAT promotion and D1 Coverage.
- Facebook: 17 × four window rows wait for the Meta workstream.
- Platform-specific metrics such as Reach, Unique Viewers, Watch Time and Completion Rate are present in source definitions but are not part of the generic 17-metric Dashboard payload. Add them only through reviewed platform-neutral capability metadata or an explicit optional-metric contract; do not silently mix them into the common 17.

### Paid Ads

Each Ads platform needs 14 × four summary rows plus Top Ads ranks. Meta waits for Phase E; Google needs source-status promotion; TikTok Ads needs the source connector and live advertiser access.

### WooCommerce

Summary metrics are implemented. Missing Report-to-Lark contracts are dimensioned rows for:

```text
product
payment_method
shipping_method
```

Use existing `dimension_type`, `dimension_value` and `rank` fields in `MKT_Report_Metric_Values`; do not create a Woo-only Dashboard table or view.

### Chatwoot proposed v1 metrics

The first version must use unambiguous source semantics:

```text
period_new_conversations
period_resolved_conversations
period_reopened_conversations
period_incoming_messages
period_outgoing_messages
current_open_conversations
current_pending_conversations
current_snoozed_conversations
current_active_agents
current_active_inboxes
avg_first_response_seconds
avg_resolution_seconds
avg_reply_seconds
tracked_conversation_count
```

Rules:

- period counts use additive daily/event facts only;
- current queue/state counts use the latest completed day, not SUM;
- duration averages must be calculated from event-level values or explicit numerator/denominator counts;
- averaging daily averages without weights is forbidden;
- agent/inbox ranking metrics use dimensioned rows and deterministic stable dimension values;
- absent samples remain `null`/N/A.

### Executive proposed safe metrics

Phase F must read validated materializations only. Safe candidates:

```text
active_channel_count
complete_channel_count
partial_or_unavailable_channel_count
paid_spend_micros              only when all included accounts share one currency
paid_impressions
paid_clicks
paid_conversions
commerce_net_sales_micros
commerce_recognized_orders
customer_service_new_conversations
customer_service_resolved_conversations
```

Do not:

- sum Organic Views/Reach across platforms as though definitions were equivalent;
- combine Ads conversion value and WooCommerce revenue without an attribution contract;
- calculate ROAS across mixed currencies;
- replace an incomplete category with zero.

## Dashboard filters that cannot match today

| Filter/Block condition | Why it cannot match | Required correction |
|---|---|---|
| `capability=customer_service` on Report Metrics | no Chatwoot Report materialization contract/settings/output | Phase C |
| Woo product/payment/shipping ranking filters | collections stay inside D1 payload and are not written as Lark rows | Phase B generic dimensioned output |
| `platform=tiktok_ads` + a metric key | source is `planned`; unavailable materialization has an empty metric payload | Phase D source implementation/UAT |
| `platform=google_ads` + a metric key | Report catalog remains `uat_pending`, so adapter is not invoked | Phase D promotion after source proof |
| `platform=instagram` + a metric key | Report catalog remains `uat_pending` | Phase A source proof/promotion |
| `platform=facebook` or `meta_ads` refresh | active retained Meta workstream owns state | Phase E after closeout |
| `window_days=9`, `15` or `90` in `MKT_Report_Metric_Values` | passed writer accepts only SingleSelect values `1`,`3`,`7`,`30` | keep outside the passed Dashboard; do not alter `fldMlTUP3Z` |
| Display V2 value on non-TikTok rows | compatibility resolver intentionally populates it only for exact TikTok Organic Integration Workspace rows | use generic `metric_key`/`display_name`, not Display V2 |
| Legacy keys such as `facebook:views` on generic Dashboard materializations | generic output key is `facebook:period_views` or `facebook:latest_total_views` | bind blocks to produced metric keys |
| `report_type=daily_organic_report` for generic Dashboard blocks | generic rows use `dashboard_performance_report` | use correct report type |
| capability/platform mismatch, e.g. `commerce + tiktok` | materialization dimensions are canonical and do not produce that pair | correct filter pair |
| Base-specific Block IDs/Option IDs not listed here | exact `.base` file was unavailable | read-only Base audit before Apply |

## Window policy

The reviewed Dashboard scope for this workstream is exactly:

```text
1D
3D
7D
30D
```

- preserve field `fldMlTUP3Z`, its existing option IDs and order;
- preserve `custom_range.window_days=null`;
- do not write 9/15/90 into `MKT_Report_Metric_Values`;
- source settings for 9/15/90 may remain for non-Dashboard or future use, but their current Lark metric-output path is incompatible and must be admission-gated;
- every implementation phase must test 1D ≤ 3D ≤ 7D ≤ 30D only when cumulative source data and complete baselines make monotonicity applicable.

## Exact implementation phases

### Phase A — Organic coverage completion

Scope:

```text
TikTok Organic     regression-only; no passed Dashboard changes
YouTube Organic    verify D1 Coverage/date range and materialize 1/3/7/30
Instagram Organic  finish source UAT, promote status, materialize 1/3/7/30
```

Repository changes expected:

```text
packages/config/src/connector-catalog.js
packages/application/src/reports/report-platform-adapter-registry.js
packages/connectors/src/d1-organic-report-source.js              only if source-contract gap is proven
packages/application/src/reports/calculate-organic-period-metrics.js only for a reviewed cross-platform bug
tests/application/multichannel-report-runtime.test.js
tests/application/report-materialization-safety.test.js
tests/application/organic-dashboard-current-total-readiness.test.js
tests/connectors/*organic*report*source*.test.js
tests/worker-runtime/multichannel-report-router.test.js
docs/tasks/<channel-specific-task>.md
docs/project-brain/<channel-specific-record>.md
```

No change allowed:

```text
Display V2 mappings
fldMlTUP3Z or option IDs
Organic Dashboard formulas/layout
Data Quality Dashboard
```

Live action is a later, separately authorized four-window materialization and D1↔Lark parity check.

### Phase B — WooCommerce Report materialization

Work:

1. read-only verify Woo Coverage and currency;
2. reconcile the eight Woo Report settings if absent;
3. generate 1/3/7/30 materializations;
4. project commerce collections into generic dimensioned Report Metric rows;
5. validate Commerce Dashboard exact filters.

Files expected:

```text
packages/application/src/reports/build-report-output-rows.js
packages/application/src/use-cases/write-dashboard-materialization-to-lark.js
packages/application/src/use-cases/generate-dashboard-report-materialization.js only if collection metadata must be normalized
packages/config/src/report-settings.seed.js only if reconciliation source is incomplete
tests/application/multichannel-report-runtime.test.js
tests/application/report-materialization-safety.test.js
tests/application/reconcile-dashboard-report-settings.test.js
tests/worker-runtime/multichannel-report-router.test.js
tests/connectors/woocommerce/*
docs/tasks/woocommerce-report-materialization-v1.md
docs/project-brain/woocommerce-report-materialization.md
```

Preferred design: reuse `MKT_Report_Metric_Values.dimension_type`, `dimension_value`, `rank` and the existing stable key format. Do not create a Woo-only Report engine, Dashboard or Lark view.

### Phase C — Chatwoot Report materialization

Admission condition: Chatwoot Final UAT must be explicitly closed with source Coverage, D1/Lark parity and safe restore evidence.

Work:

1. add `chatwoot` to the Report platform contract with capability `customer_service`;
2. add 1/3/7/30 + Custom Report settings;
3. implement a bounded `D1ChatwootReportSource`;
4. compute direct sums/latest/event-weighted duration metrics;
5. write summary and dimensioned agent/inbox rows through the existing writer;
6. validate Customer Service Dashboard filters.

Files expected:

```text
packages/application/src/reports/report-platform-adapter-registry.js
packages/application/src/reports/calculate-chatwoot-period-metrics.js       new
packages/connectors/src/chatwoot/d1-chatwoot-report-source.js              new
packages/application/src/use-cases/generate-dashboard-report-materialization.js
packages/application/src/reports/build-report-output-rows.js
packages/application/src/use-cases/write-dashboard-materialization-to-lark.js
packages/config/src/report-settings.seed.js
packages/config/src/lark-report-materialization-schema.js
packages/config/src/lark-report-schema-v2.js
apps/sync-worker/src/tiktok-d1-aware-report-job-router.js                   composition only; later rename is separate refactor
tests/application/chatwoot-report-materialization.test.js                  new
tests/connectors/chatwoot/d1-chatwoot-report-source.test.js                new
tests/worker-runtime/multichannel-report-router.test.js
docs/tasks/chatwoot-report-materialization-v1.md
docs/project-brain/chatwoot-report-materialization.md
```

### Phase D — Google Ads + TikTok Ads

Google Ads:

- verify exact source Coverage and required account/ad-level facts;
- promote Connector/Report status only from source-owned evidence;
- materialize four windows;
- verify Top Ads and currency.

TikTok Ads:

- merge/review connection readiness first;
- implement source ingestion to shared `ads_entity_state`/`ads_daily_facts`;
- complete advertiser UAT and Coverage;
- promote `planned` → `active`;
- reuse the existing Ads report adapter/calculator/writer unchanged where possible.

Expected files are source-specific plus status/tests; no new Ads Report engine.

### Phase E — Facebook Organic + Meta Ads

Admission condition: the active Meta retained-continuation workstream is fully closed.

Expected Report work should normally be limited to:

```text
source Coverage verification
connector/report catalog promotion
1/3/7/30 materialization
D1↔Lark parity
Dashboard filter verification
```

Do not edit or import retained evidence into this workstream.

### Phase F — Executive aggregate metrics

Admission condition: each category has accepted per-channel materializations.

Architecture:

```text
validated report_materializations
→ bounded materialization reader
→ executive aggregate calculator
→ normal report_materialization
→ existing Lark writer
```

Forbidden:

```text
raw/source D1 reads
provider calls
recalculation of source metrics
cross-currency aggregation
cross-platform Organic metric equivalence assumptions
```

Potential files:

```text
packages/connectors/src/d1-report-materialization-reader.js
packages/application/src/reports/calculate-executive-period-metrics.js       new
packages/application/src/use-cases/generate-executive-report-materialization.js new
packages/config/src/report-settings.seed.js
tests/application/executive-report-materialization.test.js
tests/application/report-materialization-safety.test.js
```

## Migration and Lark schema impact

| Phase | D1 migration | Lark schema | Record action |
|---|---|---|---|
| A | none expected; shared Organic tables already exist | none expected | additive/upsert four-window rows only |
| B | none expected | none if dimensioned metrics reuse existing fields | settings reconcile + additive/upsert rows |
| C | none expected if existing Chatwoot tables are sufficient | additive option values may be required for `platform=chatwoot`, `capability=customer_service`; no type mutation | additive/upsert rows |
| D | none for Report layer; source work may have its own reviewed migration | platform options already exist for Ads; verify only | additive/upsert rows |
| E | none expected | verify only | additive/upsert rows |
| F | none expected | possibly add `executive` platform/capability option only if a materialization identity requires it | additive/upsert rows |

Any schema plan must remain additive. No field rename/delete/type mutation, no option replacement, and no modification of `fldMlTUP3Z`.

## D1 ↔ Lark reconciliation contract

For every generated report identity:

```text
D1 report_materializations.report_id
  == Lark MKT_Report_Snapshots.report_id

D1 payload metric keys/count
  == Lark MKT_Report_Metric_Values rows for report_id

Organic topContent ranks
  == Lark MKT_Report_Top_Content ranks

Paid Ads topAds ranks
  == Lark MKT_Report_Top_Ads ranks

dimensioned collections
  == Lark dimensioned metric rows

current/compare/change nulls
  == explicit Lark null updates

customer/platform/capability/account/period/window
  == exact shared dimensions
```

A `source_unavailable` materialization with an empty metric payload is truthful operational evidence, but it does not satisfy a client Dashboard KPI Definition of Done.

## Regression risks

1. Replacing the 24 null/N/A rows with zero.
2. Recreating or retyping the canonical window field and breaking option IDs.
3. Writing 9/15/90 through the four-option metric writer.
4. Mixing `MKT_Metric_Definitions` keys with generic materialized keys.
5. Running both Legacy TikTok and generic Dashboard paths for the same report identity.
6. Promoting a source catalog status without live Coverage/UAT evidence.
7. Summing unknown Organic contributors or averaging daily averages.
8. Ads double counting across report levels, breakdowns or segments.
9. Ads ratios calculated before aggregation.
10. Cross-currency Executive totals.
11. Creating channel-specific Dashboard views/engines instead of dimensioned rows.
12. Updating source snapshots and Lark output under different watermarks.
13. Partial Lark writes if AI/provider validation fails.
14. Chatwoot PII leaking into Report dimensions or collection labels.
15. Woo/Chatwoot collections producing unstable keys or rank duplicates.
16. Touching active Meta continuation files or retained evidence.
17. Treating user-confirmed Base counts as independent repository proof without readback.

## Recommended parallel branch split

| Branch | Scope | May start now | Shared-file collision |
|---|---|---:|---|
| `audit/multichannel-report-coverage-v1` | this audit/docs only | yes | none after review |
| `feat/report-organic-youtube-materialization-v1` | YouTube read-only proof + repository gaps | after audit approval | registry/tests/router |
| `feat/report-organic-instagram-coverage-v1` | Instagram source UAT/status/report | after audit approval | registry/catalog/tests |
| `feat/report-commerce-dimensioned-output-v1` | Woo summary/settings/collections | after audit approval | output rows/writer/tests |
| `feat/report-chatwoot-materialization-v1` | Chatwoot adapter/calculator/settings | after Final UAT | registry/writer/schema/tests |
| `feat/report-google-ads-materialization-v1` | Google Ads promotion/materialization | after source proof | registry/catalog/tests |
| `feat/tiktok-ads-shared-facts-v1` | TikTok Ads source to shared Ads tables | after customer/app readiness | source/catalog/router |
| `feat/report-meta-materialization-v1` | Facebook + Meta Ads | only after Meta closeout | registry/catalog/source tests |
| `feat/report-executive-aggregates-v1` | materialization-only aggregate | after A-E | reader/settings/tests |
| `ops/lark-report-four-window-apply-<phase>` | separately authorized Lark/D1 materialization/parity | only after each merged implementation | Remote owner only |

Do not run two branches that both edit `report-platform-adapter-registry.js`, `report-settings.seed.js`, `build-report-output-rows.js` or `write-dashboard-materialization-to-lark.js` concurrently without an explicit stacked-base plan.

## Dependencies and waits

| Item | Waiting for |
|---|---|
| Exact Base filter/field/option audit | `Social MKT Data Hub(13).base` or authorized read-only Lark audit |
| Instagram | complete source history/Coverage UAT and status promotion |
| YouTube | exact live D1 date range/watermark and four-window parity |
| WooCommerce | Base Report settings readback; dimensioned output implementation |
| Chatwoot | Final UAT accepted closeout |
| Google Ads | source-owned proof sufficient to promote current `uat_pending` statuses |
| TikTok Ads | customer Business Center/Advertiser/app approval, merged connector, source UAT |
| Facebook Organic / Meta Ads | active Meta retained-continuation closeout |
| Executive | accepted A-E category materializations |

## Definition of Done by channel

### Common DoD

- source identity and account mapping are exact;
- source status is `active` in the correct catalog;
- the required D1 source rows and Coverage run exist for the requested period;
- source watermark is stable from admission through materialization;
- 1/3/7/30 reports use inclusive completed-day periods and previous equal-length comparisons;
- Stable keys are deterministic and replay creates no duplicate rows;
- incomplete/missing values remain `null` with N/A metadata;
- observed zero remains `0`;
- D1 materialization payload passes validation and size bounds;
- Lark explicit-null updates remove stale numeric values;
- D1↔Lark counts, keys, dimensions, values and ranks reconcile;
- exact Dashboard computed-data filters match expected rows;
- no passed Dashboard, selector or frozen formula is changed;
- full report/reliability/worker/deployment-dry-run regression passes on the exact branch head.

### TikTok Organic

- locked 68/68 rows and 24 N/A behavior remain unchanged;
- all 17 metric keys × four windows remain filterable;
- no Display V2 or selector drift.

### YouTube Organic

- active source Coverage includes baseline observations for all tracked old content or period metrics remain N/A;
- 68 expected generic rows exist for four windows;
- Top Content rows reconcile.

### Instagram Organic

- Connector and Report status promotion is evidence-backed;
- generic 17 metrics and Top Content pass four-window parity;
- Reach remains optional/platform-specific unless explicitly added.

### Facebook Organic

- Meta workstream closed;
- no replay or replacement of retained operations;
- source Coverage and four-window Report parity accepted.

### Meta Ads / Google Ads / TikTok Ads

- one explicit account report level and one ad ranking level;
- `breakdown_key=none`, `segment_key=none`;
- ratios derived after SUM;
- currency exact;
- 14 metric rows/window and deterministic Top Ads reconcile.

### WooCommerce

- exact currency and Coverage accepted;
- eight settings reconciled if missing;
- 13 summary metrics/window reconcile;
- top product/payment/shipping dimensioned rows match Dashboard filters;
- provisional/cancelled/failed/refunded semantics remain distinct.

### Chatwoot

- Final UAT closed;
- source stays PII-minimized;
- period counts/latest state/duration formulas have explicit semantics;
- duration metrics are weighted correctly or null;
- summary + agent/inbox dimensioned rows reconcile;
- Customer Service capability filters return data or truthful N/A.

### Operations

- existing Data Quality/Operations Dashboard remains unchanged;
- freshness, Coverage, status and alert semantics remain truthful;
- no synthetic zero for missing operational evidence.

### Executive

- reads only accepted materializations;
- excludes incomplete categories from numeric aggregates by returning null/N/A rather than zero;
- prevents cross-currency and non-comparable Organic aggregation;
- every aggregate contains source materialization IDs/watermarks for reconciliation.

## Audit decision

```text
Metric Matrix              READY_FOR_REVIEW
Connector implementation   NOT_AUTHORIZED
Live backfill/materialize   NOT_AUTHORIZED
Remote D1/Lark action       NOT_AUTHORIZED
Meta continuation action    NOT_AUTHORIZED
Recommended first branch    Phase B dimensioned output or Phase A YouTube proof,
                            after this matrix and Base evidence boundary are accepted
```
