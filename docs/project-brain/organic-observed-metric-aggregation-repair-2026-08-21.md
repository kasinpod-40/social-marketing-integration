# Organic observed-metric aggregation repair — 2026-08-21

## Incident

Latest Integration Base evidence showed Facebook Organic source/report freshness was current, baseline coverage was 101/101, and `latest_views` was observed for all 101 tracked contents. However a small historical subset had metric-specific `null` values: three tracked rows lacked Likes/Comments and three other tracked rows lacked Shares. The Shared Organic calculator used strict aggregate null propagation, so one missing member forced the entire Likes / Comments / Shares / Engagement aggregate to `null`. The Lark dashboard then visually rendered those unavailable numeric cards as `0`, masking the real state.

## Root cause

The generic `calculate-organic-period-metrics.js` diverged from the retained TikTok Organic observed-value aggregation semantics. Strict null propagation is appropriate when source/baseline coverage is unproven, but it is too strict when the source adapter has authoritatively declared complete/revisable coverage and only particular metric members are unobserved.

## Permanent contract

- Source-level missing values remain `null`; they are never converted to zero.
- Row-level combined Engagement remains strict: if Likes, Comments, or Shares is missing for that row, row Engagement stays `null`.
- When source coverage is `complete` or `revisable`, current-total aggregates may sum observed members and return `null` only when the metric has no observed member at all.
- Period aggregates use observed-member subtotal only when source coverage is authoritative **and** every tracked content has baseline coverage.
- With partial/unproven source coverage or incomplete period baseline coverage, aggregates remain fail-closed/strict.
- Observed zero remains `0`; negative corrections are preserved.
- Aggregate Engagement is derived from the aggregate Likes + Comments + Shares under the same coverage gate.
- Weighted averages remain strict.

This is a report-calculation repair only. It does not mutate provider facts, D1, Lark, Queue, Worker schedules, Production, or Customer Base provisioning.

## Meta Ads boundary

The same Base inspection showed `MKT_Ads_Daily` and `MKT_Ads_Creatives` contain no Meta rows. This repair intentionally does **not** fabricate them. Current repository architecture keeps detailed Meta paid facts in D1/Shared Report and projects the currently contracted canonical Meta entity levels to Lark. Expanding that projection requires a separate reviewed contract, not a data patch hidden inside Organic reporting.

## Verification

PR #662 Branch Verification run `32444055524`, job `96660217831`, passed every gate on commit `750729654e9c6f5b8b9189f29bf7374f7dbae63c`: architecture/hygiene, focused Report/Meta/Woo/Chatwoot/TikTok suites, full Unit + Workers Runtime, Report Reliability, Dependency Audit, Wrangler dry run and diff whitespace check.

The closure-document commits do not change runtime behavior. The final PR head must still receive a fresh Branch Verification before merge; the merge result is the authoritative final SHA.
