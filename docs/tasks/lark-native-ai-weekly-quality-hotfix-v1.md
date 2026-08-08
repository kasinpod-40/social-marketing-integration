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

- Upgrade retained compact evidence to `lark_ai_compact_quality_v3`.
- Add compact top-level `qualityContext` with business-evidence count, comparison-evidence count, deterministic Strengths fallback requirement and recommendation mode.
- Reuse each channel's existing `comparisonEvidencePresent` instead of adding another repeated per-channel policy field, preserving the reviewed `metric_summary_json <= 2800` budget.
- If a channel has no comparison evidence, prohibit magnitude/performance adjectives from current values alone.
- If no channel has comparison evidence, Strengths must use the reviewed fallback: `ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน`.
- Observed spend remains a factual value only and never implies planning intent, investment quality or efficiency.
- When business evidence exists but comparison does not, Recommendations must stay on neutral business follow-up using actual metric/creative evidence; they must not recommend filling data or repairing systems.

Quality v3 generated technically, and Strengths converged to the exact fallback, but the output still behaved too much like a Data Quality report: Weaknesses included an action, Recommendations still included wait/data-completion instructions and an evidence footnote, and field-level Markdown headings remained possible.

## Quality v4 — Executive Writer Contract

The target is the approved business-facing weekly-report style: business overview first, concise highlights, performance-only watchouts and next-week marketing actions. Missing-data language must remain secondary and must never dominate the report.

Reuse the same evidence hardener and native AI Automation. Do not add another AI engine or edit the Lark Automation UI.

- Upgrade retained `lark_ai_compact_quality_v3` evidence to `lark_ai_compact_quality_v4`.
- Remove `readinessStatus` from `channelBusinessEvidence`; readiness already exists in the separate status vector and must not compete with Business evidence for attention.
- For channels without Business evidence, omit `displayName` and retain only compact channel identity/status-vector handling.
- Replace the previous policy-enum block with one compact `writerContract`:
  - Overview: 2–4 business-first sentences; current-only values may be stated but not called large/small/good/bad without comparison.
  - Strengths: with zero comparison evidence, return the exact reviewed fallback.
  - Weaknesses: performance-only; no recommendation/action verbs. Missing channels may appear in at most one concise item.
  - Recommendations: business-action-only from existing evidence. Never recommend filling/waiting/checking data or systems when Business evidence exists. For observed-only Ads with clicks/impressions/spend, recommend deriving CTR/CPC and using them as the next comparison baseline.
  - Output: no Markdown heading, evidence footnote, JSON/field name or internal status term.
- Preserve the reviewed input budgets: `metric_summary_json <= 2800`, status vector `<=700`.

## Controlled v4 retry and deterministic local quality gate

Reuse `scripts/lark-native-ai-weekly-7d-quality-retry.mjs` as the existing two-stage guarded operator:

1. Require clean exact `main`, one generated 7D Executive UAT row with source `promptShape=lark_ai_compact_quality_v3`, AI Automation active and Notification Automation inactive.
2. Preparation write upgrades evidence to quality v4, clears prior outputs, returns `generation_status=pending`, keeps notification flags false and does **not** touch `failure_code`.
3. Read back the exact prepared quality-v4 state.
4. Wake the existing Automation using a second write containing only `failure_code=CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V6`.
5. Observe the same row and read all four generated outputs.
6. Apply a deterministic local Quality Gate. The operator returns `ok=true` only when generation succeeds **and** all checks pass:
   - no internal-status language;
   - no Markdown heading/evidence footnote;
   - exact Strengths fallback when comparison evidence count is zero;
   - no unsupported performance-magnitude language without comparison;
   - no action/recommendation language in Weaknesses;
   - no Data Ops/wait-data recommendation;
   - observed-only Business evidence still produces at least one measurable marketing follow-up.

A generated result that fails this local gate is not retried automatically and must not enable Notification.

## Safety

- AI engine / Automation creation: 0
- Lark Automation UI change: 0
- external model/API key: 0
- Report materialization: 0
- Remote D1: 0
- Queue / Worker: 0
- Schedule: disabled
- Production: BLOCKED
- quality-v4 preparation write after merge: exactly 1
- failure-code-only V6 trigger write after merge: exactly 1
- Notification send: 0
