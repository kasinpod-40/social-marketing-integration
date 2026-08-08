# Lark Native AI Business Metric Consistency V9 — Acceptance

Acceptance requires all of the following:

- quality-v5 retained V8 evidence is the only accepted source;
- observed clicks/impressions remain unchanged;
- raw CTR is removed when the same Ad has finite clicks and impressions > 0;
- `derived_ctr_percent` is deterministic from `clicks / impressions * 100`;
- retained V8 output revalidates to exactly `insight_ctr_inconsistent_with_components` before any write;
- V9 performs one preparation write and one failure_code-only trigger write;
- Prompt v3 remains unchanged;
- AI Automation remains active;
- Notification Automation remains inactive;
- post-generation Executive Writer Quality Gate passes with zero violations;
- Schedule remains disabled and Production remains blocked.
