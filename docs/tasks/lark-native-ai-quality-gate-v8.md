# Lark Native AI Executive Writer Quality Gate V8

## Incident

Controlled Prompt v3 retry V7 generated all four Native Lark AI outputs successfully, but the local quality gate returned two false positives:

- `insight_contains_action` because neutral prose `ข้อมูลที่ตรวจสอบแล้ว` contained the substring `ตรวจสอบ`;
- `weaknesses_contains_action` because the exact approved fallback `ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี` contained the substring `ควร`.

The V7 Summary also avoided real business metric values. Its campaign title contained `(01-12)` and the prose contained `อันดับ 1`, so the old `/\d/` gate incorrectly treated non-metric digits as numeric business evidence.

The first V8 attempt then stopped before any write with `LARK_NATIVE_AI_QUALITY_GATE_V8_SOURCE_ROW_INVALID`. The candidate row existed, but the V8 source predicate incorrectly required the transient V7 trigger marker to remain in `failure_code`. A successful AI Automation finalization clears `failure_code`, so the reviewed finalized V7 source state has `generation_status=generated`, all four outputs present and `failure_code` empty.

Notification remained inactive, `notification_eligible=false`, `sent_to_group=false`, Schedule disabled and Production blocked.

## Confirmed correction

Do not change the four live Prompt v3 actions again.

Reuse the existing Prompt v3 and retained quality-v4 business evidence, then:

1. classify action language semantically enough to allow `ตรวจสอบแล้ว` and the exact Weaknesses fallback while still rejecting real action leakage;
2. derive up to three safe numeric Summary facts only from reviewed business metric keys, excluding `rank`, campaign-name digits, IDs and `spend_micros`;
3. upgrade the compact evidence to `lark_ai_compact_quality_v5` with `summaryRequiredFacts` and an explicit rule that Summary must quote at least one required metric value;
4. load only the finalized V7 source row with `generation_status=generated`, quality-v4 evidence, all four outputs present, Notification guards false and empty `failure_code`;
5. revalidate the retained V7 outputs before any write and require the only remaining violation to be `insight_missing_business_metric_value`;
6. perform one preparation write, preserving empty `failure_code`;
7. perform one `failure_code`-only V8 trigger write;
8. require the corrected Executive Writer gate to pass after Native Lark AI generation.

If the source predicate ever fails again, return bounded candidate-state diagnostics instead of only an `exactMatches` count.

## Safety

- Lark Prompt mutation: 0
- new Automation: 0
- new AI provider/engine: 0
- Report materialization: 0
- D1 write: 0
- Queue send: 0
- Worker deploy: 0
- failed first V8 attempt Remote write: 0
- evidence rewrite: exactly 1 guarded UAT row update after corrected preflight passes
- V8 trigger write: exactly 1 `failure_code` field update
- Notification send: 0
- Schedule: disabled
- Production: BLOCKED

## Required verification

Run the standard Branch Verification including syntax/architecture/hygiene, focused regressions, Unit and Workers runtime tests, Report reliability, Dependency audit, Wrangler dry-run and diff whitespace check. Do not merge until every gate passes.
