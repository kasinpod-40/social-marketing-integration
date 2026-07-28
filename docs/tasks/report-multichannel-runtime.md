# Multichannel Report Materialization Runtime

Status: `repository_implementation_complete_validated`

Branch: `codex/report-multichannel-runtime`

Stacked base: `codex/dashboard-rolling-period-presets` at
`9b7cadbbfa4819d0f68567bdbc13ff0166a6ea64`

Draft PR: `#199`

## Scope

Repository-only implementation for rolling/custom Dashboard reports across:

- Organic: `facebook`, `instagram`, `tiktok`, `youtube`
- Paid Ads: `meta_ads`, `google_ads`, `tiktok_ads`

This workstream does not modify `docs/current-task.md`, Remote D1, Live Lark, Queue,
Schedule/Cron, Worker deployment, Secrets or Production configuration.

## Implemented contracts

### Shared runtime

- Reuses `report.materialization.generate`, `report_requests`, shared Queue admission,
  Reliability lock/run lifecycle and `report_materializations` Stable identity.
- Custom-range jobs validate the durable request customer, platform, account, period and
  comparison identity before entering Reliability processing.
- Preset jobs resolve the canonical account from the runtime profile; custom jobs use the
  durable `report_requests.account_key` and do not require an active connector configuration.
- Preserves `report.daily.generate` and `report.weekly.generate` on the existing TikTok
  compatibility path, including the existing post-processing feature gate.
- Generic platform registry keeps provider adapters outside shared calculation code.
- UAT-pending/planned sources materialize `source_unavailable`; adapters are not invoked and
  no success/data is fabricated.

### Organic

- Generic D1 reader uses `organic_content_state`, `organic_content_observations`,
  `data_coverage_runs` and `data_coverage_entities`.
- The legacy TikTok D1 source is a compatibility facade over the same generic reader rather
  than a duplicate query engine.
- Cumulative metrics use end observation minus the last pre-period observation.
- New content inside the period receives a zero baseline.
- Old content without a pre-period baseline remains `partial`.
- `null` remains unknown, observed zero remains zero and negative corrections remain negative.
- Aggregate values remain `null` when a required contributing value is unknown.
- Top Content ordering is deterministic by period views, engagement and Stable content key.

### Paid Ads

- Generic D1 reader uses `ads_daily_facts`, `ads_entity_state` and Coverage.
- Summary facts require one explicit `report_level`, `breakdown_key=none` and
  `segment_key=none`; Top Ads use the separate `ad` report level.
- Spend, impressions, clicks, conversions and value are summed before CTR, conversion rate,
  CPC, CPM, CPA and ROAS are derived.
- Top Ads rank deterministically by spend, impressions and provider Ad ID.
- Revision/source watermark is retained in the materialization and compared with the admitted
  request watermark; a missing or changed watermark fails closed.

### Materialization consumers

- Dashboard/Lark reader exposes only `report_materializations`; detailed-fact query methods do
  not exist on the reader boundary.
- Payloads are validated, JSON-safe and capped at 256 KiB before persistence/consumption.
- Lark Snapshot, Metric Values, Top Content and Top Ads rows are built from the validated
  payload only.
- Executable Lark schema v2 adds `MKT_Report_Top_Ads`, `top_ads_limit`, all seven Report Settings
  platform options and platform/data-status options through the existing plan-first
  `setup:report-schema` installer.
- No Lark schema was applied by this workstream.

### AI summary

- Application boundary accepts only a validated materialization payload.
- Provider is injectable and receives explicit instructions not to calculate or repair metrics.
- `null`, zero, coverage and data status are preserved.
- AI validation/generation occurs before Lark output writes to avoid partial side effects when an
  enabled provider binding is missing or invalid.
- `source_unavailable` and `not_observed` payloads skip AI without resolving a provider.
- `MKT_REPORT_AI_SUMMARY_ENABLED` defaults to `false` and requires D1 report reads.
- No Workers AI binding was present in the reviewed base; Production binding remains an explicit
  follow-up and is not guessed in repository configuration.

### Settings

- Canonical `integration_workspace` settings cover all seven platform scopes for 3/7/9/15/30/90
  rolling days and Custom range.
- The complete setting set is 51 rows: two TikTok 1D/7D compatibility rows plus seven platform
  scopes multiplied by seven Dashboard period definitions.
- Settings seed `top_content_limit=5` and `top_ads_limit=5` consistently.
- Legacy profile labels resolve to canonical Integration Workspace rows and are never created as
  active identities.

## Validation fixes

Real CI found and this branch corrected two repository gaps:

1. Added fail-closed `MKT_REPORT_AI_SUMMARY_ENABLED=false` to
   `wrangler.sync.example.jsonc` so release examples cover every Storage runtime flag.
2. Replaced the legacy hardcoded nine-setting reconciliation assertions with the canonical
   51-setting count derived from `DASHBOARD_REPORT_PLATFORM_SCOPES`.

No test was weakened to hide a failure; the configuration and stale regression expectation were
corrected to match the implemented contract.

## Tests added/updated

- Unit: platform registry, Organic baseline/null/correction, source-unavailable materialization,
  watermark safety, materialization-only AI input, provider gap and Top Ads rows.
- Integration: D1 Ads report-level/breakdown/segment fences, aggregate-first ratios and
  deterministic ranking.
- Workers runtime: D1-read gate and unknown-platform fail-closed behavior.
- Config: all platform setting seeds, Top Ads limits, default-off AI flag and executable Lark
  schema v2.
- Existing TikTok report/reliability suites remain active for regression coverage.

## Validation state

Branch Verification run `30368044619` passed on implementation HEAD
`5e3098b38d7298d0956d66bee19a0925faa7575a`:

```text
npm ci                               PASS
npm run check                        PASS
focused staged TikTok regression     PASS
npm test                             PASS — Node 1318/1318; Workers 14/14
npm run test:report-reliability      PASS — 100/100
npm audit                            PASS — 0 vulnerabilities
npm run deploy:dry-run               PASS — API and Sync Worker; no deployment
```

The temporary validation/export workflows were removed, and temporary Draft PRs `#200` and
`#201` were closed without merge. No Remote action or Production mutation was used to obtain
these results.

## Remaining authorized follow-ups

1. Preview `npm run setup:report-schema`; do not apply until a separate Live Lark authorization.
2. Provision `LARK_TABLE_MKT_REPORT_TOP_ADS` only after the schema apply is separately approved.
3. Decide and provision the Production AI provider/binding before enabling
   `MKT_REPORT_AI_SUMMARY_ENABLED`.
4. Promote Facebook/Instagram/Meta Ads/Google Ads/TikTok Ads source status only through their
   connector catalog/UAT workstreams; this report runtime must not bypass those gates.
