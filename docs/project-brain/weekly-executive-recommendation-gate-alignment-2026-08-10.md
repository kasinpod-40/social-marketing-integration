# Weekly Executive Recommendation Decision Gate Alignment — 2026-08-10

## Live evidence

Fresh Weekly Executive Decision Preview on `main@602dacd1f17d5e130e1a6edc5b0d34b2bbb5400a` for `2026-08-03..2026-08-09` reached Native AI generation successfully:

```text
poll 1 pending
poll 2 pending
poll 3 pending
poll 4 generated
insight_summary present
strengths present
weaknesses present
recommendations present
```

The local Decision Quality Gate then stopped the run with:

```text
LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED
recommendations_missing_decision_actions
recommendations_missing_paid_action
recommendations_missing_ad_candidate
```

The generated Recommendations were generic by channel, including Meta Ads analysis, Google Ads CTR/CPC baseline work and an unnamed Organic test. They did not emit decision labels or name a Paid candidate.

Mutation evidence:

```text
recordWriteCount                         2
triggerWriteCount                        1
queueAdmissionCount                      0
messageSendCount                         0
notificationAutomationActivationCount   0
scheduleActivationCount                  0
production                               BLOCKED
```

Because the Fresh identity was triggered and generated, it is immutable attempt evidence. It must not be reset, recovered or retriggered.

## Confirmed root cause

The Decision Quality Gate introduced by Weekly Executive Decision Report v1 correctly requires explicit decision actions and named candidates. The existing Lark Native AI Prompt v3 `recommendations` action still permitted generic channel-level action text and an observed-only CTR/CPC baseline recommendation without requiring a named Ad candidate or decision labels.

The failure is therefore a prompt-to-gate contract mismatch, not a Native AI execution failure and not a metric-summary budget failure.

## Repository correction

- keep the existing Prompt v3 architecture, reference slots and four Native AI actions;
- change only the `recommendations` prompt semantics;
- require every item to start with an approved decision label;
- require named Content/Paid candidates when those candidates exist;
- keep `[SCALE]` limited to the same candidate with `scale=1` evidence;
- require `[NO-SCALE]` for explicit funnel up/down divergence;
- disallow generic channel-only Paid recommendations when named Ad candidates exist;
- keep Organic without Paid proof at `[TEST]` maximum and block fabricated same-creative linkage;
- bump only the Fresh Executive Decision identity contract to `lark_weekly_7d_executive_decision_preview_v2` so a new row is created without mutating the generated quality-failed identity.

## Live apply boundary

Repository code cannot safely replace the prompt text inside the existing Lark UI Automation through the reviewed API boundary. Live apply therefore changes only the `recommendations` Native `AI-generated text` action manually in the existing active `AI Materialization → MKT_AI_Report_Runs` Automation, preserving its existing reference pills and output binding.

`insight_summary`, `strengths`, `weaknesses`, Base Notification Automation, Queue producer, Schedule and Production remain unchanged.
