# Lark Native AI Weekly Quality Hotfix v1

## Incident

The first successful native Lark AI weekly Executive UAT generated all four outputs, but the content failed the business quality gate:

- cross-output inconsistency: the Executive summary said Meta Ads lacked enough evidence while Strengths claimed strong click performance;
- unsupported inference: observed spend/click facts were interpreted as "large" and as evidence of planned investment without a baseline or planning-intent fact;
- data-readiness language leaked into Weaknesses/Recommendations as if it were a marketing-performance conclusion;
- placeholder/no-data ranked rows were still present in compact prompt evidence.

Notification remained disabled and no message was sent.

## Quality v2 correction

Reuse the existing compact evidence module and native AI Automation. Do not create another AI engine, model provider or Automation.

1. Add an evidence-quality projection on top of the current compact v1 payload.
2. Remove placeholder ranked rows (`no_data`, `ไม่มีข้อมูล`, invalid placeholder URLs/IDs, or rows with no usable business value).
3. Add explicit interpretation policy inside the evidence payload:
   - magnitude words require comparison, benchmark, or ranking evidence;
   - observed spend never implies planning intent;
   - missing data is not a performance weakness;
   - data completion is not the primary marketing recommendation;
   - all four outputs must remain mutually consistent;
   - no evidence footnote or system-status prose in user-facing output.
4. Keep nine channel identities and current compact input budgets.
5. Notification Automation remains inactive throughout.

The resulting `lark_ai_compact_quality_v2` evidence generated successfully through Native Lark AI, but the content still failed the final quality gate. With zero comparison-evidence channels, Strengths still called Meta Ads clicks "จำนวนมาก"; Recommendations still promoted data completion and used the ambiguous phrase "หาความรู้สึกเบื้องหลังผลลัพธ์".

## Quality v3 correction

Do not edit the Lark Automation UI again. Strengthen the existing evidence contract instead.

- Upgrade only retained `lark_ai_compact_quality_v2` or original compact-v1 evidence to `lark_ai_compact_quality_v3`.
- Add compact top-level `qualityContext` with business-evidence count, comparison-evidence count, deterministic Strengths fallback requirement and recommendation mode.
- Reuse each channel's existing `comparisonEvidencePresent` instead of adding another repeated per-channel policy field, preserving the reviewed `metric_summary_json <= 2800` budget.
- If a channel has no comparison evidence, prohibit magnitude/performance adjectives such as `มาก`, `น้อย`, `สูง`, `ต่ำ`, `เด่น`, `ดี`, `แย่` from current values alone.
- If no channel has comparison evidence, Strengths must use the reviewed fallback: `ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน`.
- Observed spend remains a factual value only and never implies planning intent, investment quality or efficiency.
- When business evidence exists but comparison does not, Recommendations must stay on neutral business follow-up using the actual metric/creative evidence; they must not recommend filling data or repairing systems.
- Require direct measurable language and prohibit ambiguous/metaphorical wording such as `ความรู้สึกเบื้องหลังผลลัพธ์`.

## Controlled v3 retry

Reuse `scripts/lark-native-ai-weekly-7d-quality-retry.mjs` as a two-stage guarded operator:

1. Require clean exact `main`, exact generated 7D Executive UAT row, source `promptShape=lark_ai_compact_quality_v2`, AI Automation active and Notification Automation inactive.
2. Preparation write upgrades evidence to quality v3, clears the four prior AI outputs, returns `generation_status=pending`, clears `generated_at`, keeps notification flags false, and **does not write `failure_code`**.
3. Read back and require exact quality-v3 evidence, pending state, empty outputs and safe notification flags.
4. Trigger with a second write whose only field is `failure_code=CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V5`.
5. Observe the same row for up to 180 seconds and print all four generated outputs for final quality review.

## Safety

- AI engine / Automation creation: 0
- Lark Automation UI change: 0
- external model/API key: 0
- Report materialization: 0
- Remote D1: 0
- Queue / Worker: 0
- Schedule: disabled
- Production: BLOCKED
- quality-v3 preparation write: exactly 1
- failure-code-only trigger write: exactly 1
- Notification send: 0
