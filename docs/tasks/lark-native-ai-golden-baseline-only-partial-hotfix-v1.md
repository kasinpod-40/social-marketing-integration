# Lark Native AI Golden Dataset Baseline-only Partial Hotfix v1

## Incident

The first live Controlled Preview Exact Terminal attempt stopped safely at:

```text
stage   build-exact-four-window-readiness
code    LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_READINESS_NOT_READY
window  1D
blocker GOLDEN_DATASET_TIKTOK_NOT_COMPLETE
```

No Lark write, AI call, D1, Queue, Worker, Provider, Automation, notification, Schedule or Production action occurred.

The retained 1D source evidence proved:

```text
freshness                       fresh
data_status                     partial
baseline_coverage_rate          0.9985
tracked_content_count           2024
baseline_covered_content_count  2021
baseline_missing_content_count  3
current-total metrics           6/6 available and observed
period-delta metrics            6/6 baseline_incomplete and unobserved
```

The Report is partial only because three Content records lack the previous-period baseline. Current cumulative values remain complete and usable. Relabeling the Report as complete would be false; blocking every Preview despite complete current evidence is unnecessarily strict.

## Hotfix contract

A TikTok partial Report may satisfy the Controlled Preview Golden Dataset gate only when all of the following are true:

1. Channel availability and coverage remain `partial`; they are not rewritten as `complete`.
2. Freshness is exactly `fresh`.
3. No critical Data Quality issue exists.
4. All six exact current-total metrics are present, `available`, observed and numeric:
   - `tiktok:latest_total_views`
   - `tiktok:latest_total_likes`
   - `tiktok:latest_total_comments`
   - `tiktok:latest_total_shares`
   - `tiktok:latest_total_engagement`
   - `tiktok:latest_engagement_rate`
5. All six exact period-delta metrics are present and are only `baseline_incomplete`, with null current values and `observed=false`.
6. All five exact Data Quality metrics are present, available, observed and numeric.
7. Baseline coverage is at least `0.99` and less than `1`.
8. `tracked = covered + missing`, `tracked > 0`, and `missing > 0`.
9. The reported coverage rate reconciles to `covered / tracked` within `0.0001`.
10. Every other summary metric must be either a valid available observation or one of the six exact baseline-incomplete period metrics.

Any current-total gap, unsupported unavailable metric, critical issue, sub-99% coverage, stale evidence or inconsistent counts remains blocked with `GOLDEN_DATASET_TIKTOK_NOT_COMPLETE`.

## Expected Preview semantics

The TikTok Lark row remains visibly partial:

```text
readiness_status  report_partial
data_status       partial/report_partial according to the existing row contract
```

The hotfix changes only Golden Dataset admission for the bounded Controlled Preview. It does not enable trend recommendations for missing period deltas, fabricate delta values or change Report materialization facts.

## Scope and safety

Changed scope:

```text
packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js
tests/application/lark-native-ai-controlled-preview-readiness.test.js
docs/tasks/lark-native-ai-golden-baseline-only-partial-hotfix-v1.md
docs/project-brain/lark-native-ai-controlled-preview-exact-terminal.md
```

Unchanged:

- `docs/current-task.md` and Chatwoot ownership;
- Report materialization rows and retained live evidence;
- Lark schema and Views;
- Live Pilot write bounds;
- AI/Automation/notification/Schedule/Production state;
- Remote Worker, D1, Queue and Provider state.

Repository implementation and CI perform zero Remote action. A new explicit Terminal run occurs only after merge and exact-main verification.
