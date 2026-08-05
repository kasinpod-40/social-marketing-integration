# Report Source Readiness Contract Repair v1

## Authority

```text
Program          REPORT_SOURCE_READINESS_CONTRACT_REPAIR_V1
Branch           hotfix/report-source-readiness-contract-v1
Exact base       6b88fd9eb05b25a7e3a3e7de9930193bab6c1ace
Environment      Integration Workspace / development only
Production       BLOCKED
```

This record supersedes the stale Notification Smoke Poll Recovery pointer that remained in `docs/current-task.md`
on the exact base. The Notification smoke incident and poll-only recovery authority remain unchanged and are not
invoked by this workstream.

## Read-only reconciliation facts

The retained source reconciliation proved `customer_key=chemistry_k` and `account_key=chemistry_k`; there is no
account identity mismatch. Provider requests, Queue actions, D1/Lark mutation and Worker deployment were zero.

Validated source facts before this repository repair:

| Platform | Canonical authority | Confirmed state |
| --- | --- | --- |
| YouTube Organic | D1 content state/observations | 837 / 837, ready |
| Instagram Organic | D1 content state/observations | 26 / 26 through 2026-07-31 |
| Facebook Organic | D1 account daily + retained source evidence | Account scope available; Content observations absent |
| Meta Ads | D1 `ads_daily_facts` | 170 Ad entities; daily grain `ad / publisher_platform=* / none` |
| Google Ads | D1 `ads_daily_facts` | 760 Ad entities; 285 daily facts at `campaign / all / all` |
| WooCommerce | D1 Commerce facts/state | 212 daily facts; 3,439 order-state rows through 2026-07-31 |
| Chatwoot | D1 Customer Service daily facts | 200 conversation + 42 account daily rows through 2026-08-01 |
| TikTok Ads | Catalog only | planned; no connector/facts/Coverage |

Lark rows alone are never sufficient proof of readiness. D1 facts, exact Coverage datasets and source watermarks
remain authoritative for Report materialization.

## Root causes

### Historical alerts

The reviewed preflight counted every open critical platform alert as a current Report blocker. Historical
`sync_failed`, Queue permanent-failure and DLQ alerts are retained forensic truth, but they are not current
`dashboard_performance_report` incidents after exact Coverage and facts are complete.

The repaired gate blocks only Report work, Report locks, Report DLQ and critical alerts bound to a current/failed
Report sync identity. Historical Connector alerts remain counted in evidence and are never deleted, auto-resolved,
hidden or severity-downgraded.

### Coverage selection

The old selector chose the latest arbitrary Coverage row. Equal completion timestamps could select a dataset that
the Report does not use. The repaired contract selects exact platform datasets:

```text
facebook.content.cumulative / facebook.account.daily
instagram.content.cumulative / instagram.account.daily
organic_content_cumulative (TikTok / YouTube legacy contract)
meta_ads.performance.daily
campaignDailyMetrics
woocommerce_orders
chatwoot.conversation_daily + chatwoot.account_daily
```

Chatwoot selects one latest row per required dataset with a deterministic partitioned order and requires both
watermarks. `chatwoot.accounts` or a watermark-less recent-window row has no authority over the daily Report.

### Paid Ads source grain

The old reader required `account/ad + none/none` for every platform. The repaired Shared reader binds itself to the
platform registry, reads the validated fact levels, selects one reviewed breakdown/segment family and aggregates
its partitions exactly once.

Meta Ads Account summary and Top Ads aggregate `ad` rows partitioned by `publisher_platform=*`; curated Lark Ads
Daily may remain zero because D1 is the authority. Google Ads Account summary aggregates Campaign `all/all` facts.
Google has no proven Ad-level performance facts in this contract, so Top Ads remains empty with
`topAdsAvailability=not_observed`; no zero or fabricated Ad metric is created.

### Facebook missing Content observations

Facebook may use exact `facebook.account.daily` Coverage and `organic_account_daily_facts` when canonical Content
observations are absent. The materialization adds proven Account metrics only. Content metrics remain null with
`availabilityStatus=not_observed`, and Top Content remains empty. No Lark row is copied into D1 and no Content
observation, baseline or zero metric is synthesized.

## Shared implementation roots

```text
packages/application/src/reports/report-platform-adapter-registry.js
packages/application/src/reports/calculate-organic-account-period-metrics.js
packages/application/src/use-cases/generate-dashboard-report-materialization.js
packages/connectors/src/d1-organic-report-source.js
packages/connectors/src/d1-ads-report-source.js
packages/connectors/src/d1-chatwoot-report-source.js
scripts/lib/report-runtime-closeout-reviewed-binding.js
scripts/lib/report-runtime-closeout-channel-binding.js
scripts/report-channel-remote-readiness-reviewed-terminal.mjs
```

No new Report engine, Reliability framework, Queue framework, D1 writer, Lark sync engine, Coverage engine or
runtime wrapper is introduced.

## Safety baseline preserved

```text
MKT_NOTIFICATION_RUNTIME_ENABLED      true
MKT_NOTIFICATION_LARK_SEND_ENABLED    true
MKT_NOTIFICATION_LARK_MIRROR_ENABLED  true
Notification Admission                false
Report AI execution                   false
Schedules                             false during implementation
Production                            BLOCKED
```

The original Notification smoke execution remains forbidden from blind rerun. This repository repair performs no
Provider request, Queue admission, D1/Lark business mutation, Worker deployment, schedule activation or Production
action.

## Post-merge sequence

1. Rerun the existing Finalizer on exact merged main; expected mutations remain zero and Notification baseline is
   preserved.
2. Rerun SELECT-only per-channel readiness and retain historical Connector alert counts in evidence.
3. Build the retained handoff with the existing reviewed builder; never hand-write JSON.
4. Materialize 1D/3D/7D/30D for Ready channels and verify D1/Lark parity, checksums, replay and safe restore.
5. Run incremental catch-up only from the day after each confirmed watermark through the latest completed Provider
   day; never Full-history replay to compensate for this reader bug.
6. Activate only approved Integration Workspace source schedules through the existing central scheduler, excluding
   TikTok Ads and automatic Notification Admission.
7. Observe at least one scheduled run: exactly-once admission, terminal sync, advancing watermark, idempotent D1,
   Lark parity, Report refresh, no unexpected DLQ and preserved Notification Runtime.
