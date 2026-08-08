# Lark Native AI V9 Read-only Acceptance

## Incident

Controlled V9 generated internally consistent business metrics: `clicks=4553`, `impressions=582054`, and derived CTR `0.78223%`. The local quality gate still returned `insight_contains_action` because the descriptive phrase `ค่าดัชนีการคลิกที่คำนวณได้` contains the substring `คำนวณ`.

This is a validator false positive, not a new AI/content failure.

## Correction

- keep Prompt v3 and the generated V9 row unchanged;
- treat descriptive `คำนวณได้` / `ที่คำนวณได้` as non-action language while continuing to reject imperative `คำนวณ ...` outside Recommendations;
- add a shared read path for retained `lark_ai_compact_quality_v6` evidence;
- add a read-only acceptance operator that validates the exact finalized V9 Executive UAT row using the corrected shared gate;
- perform zero Lark writes and zero AI calls.

## Acceptance

The read-only closeout must require:

- exact weekly Executive UAT identity;
- `generation_status=generated`;
- `promptShape=lark_ai_compact_quality_v6`;
- all four outputs present;
- `failure_code` cleared after successful Automation finalization;
- `preview_mode=true`;
- `notification_eligible=false`;
- `sent_to_group=false`;
- exact active AI Automation identity;
- exact inactive Notification Automation identity;
- corrected Executive Writer quality gate passes with zero violations;
- at least one derived CTR fact exists and is consistent with clicks/impressions.

## Safety

- Lark writes: 0
- AI generation: 0
- Prompt mutation: 0
- Notification sends: 0
- D1/Queue/Worker: 0
- Schedule disabled
- Production BLOCKED
