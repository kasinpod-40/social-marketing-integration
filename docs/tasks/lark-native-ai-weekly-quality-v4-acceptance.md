# Lark Native AI Weekly Quality v4 Acceptance

This workstream reuses the existing Native Lark AI Automation and weekly quality evidence path.

Acceptance:

- retained quality-v3 evidence upgrades to `lark_ai_compact_quality_v4` within the existing 2800/700 input budgets;
- Business evidence no longer repeats readiness status;
- the evidence carries one compact Executive Writer Contract covering Overview, Strengths, Weaknesses and Recommendations;
- the two-stage operator prepares v4 without touching `failure_code`, then triggers with `failure_code` only using `CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V6`;
- generated outputs are checked locally for internal-status leakage, unsupported magnitude claims, Weaknesses/action contamination, Data Ops Recommendations, Markdown headings and evidence footnotes;
- Notification remains inactive, Schedule disabled and Production blocked;
- repository implementation performs no Remote write, AI call, Queue action, D1 mutation or Worker deployment.
