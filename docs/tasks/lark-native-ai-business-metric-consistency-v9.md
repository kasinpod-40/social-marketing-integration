# Lark Native AI Business Metric Consistency V9

## Incident

Controlled V8 completed technically and the local Executive Writer gate returned `passed=true`, but the generated Summary exposed a business-fact contradiction:

- clicks = 4,553
- impressions = 582,054
- CTR = 0

The observed clicks and impressions imply a non-zero CTR. Therefore the V8 local gate passed an internally inconsistent derived ratio and Notification must remain blocked.

## Root cause

Quality-v5 evidence allowed raw `ctr` from ranked Ad evidence to survive without checking consistency against the same Ad's `clicks` and `impressions`. The Summary validator also had no ratio-consistency check.

## Correction

Reuse Prompt v3 and the existing Native AI Automation. Do not edit Lark prompts again.

1. Keep raw observed clicks and impressions.
2. When both are finite and impressions > 0, remove raw `ctr` from the AI evidence and derive `derived_ctr_percent = clicks / impressions * 100` deterministically.
3. Upgrade only the retained UAT evidence from `lark_ai_compact_quality_v5` to `lark_ai_compact_quality_v6`.
4. Require any numeric CTR claim in Summary to match the derived percent within a bounded formatting tolerance.
5. Before any V9 write, revalidate the retained V8 output and require the only corrected violation to be `insight_ctr_inconsistent_with_components`.
6. Perform one preparation write and one `failure_code`-only V9 trigger write.
7. Require the full Executive Writer Quality Gate to pass after generation.

For the retained Meta Ads evidence, deterministic CTR is approximately `0.78223%` from `4553 / 582054 * 100`.

## Safety

- Lark Prompt mutation: 0
- new Automation/provider/AI engine: 0
- Report materialization: 0
- D1/Queue/Worker: 0
- evidence rewrite: exactly 1 guarded UAT row update
- trigger: exactly 1 `failure_code` field update
- Notification send: 0
- Schedule disabled
- Production BLOCKED

## Required verification

Run standard Branch Verification plus focused Executive Writer and V9 source regressions. Do not merge until every gate passes.
