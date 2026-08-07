# Lark Native AI Weekly Quality Hotfix v1

## Incident

The first successful native Lark AI weekly Executive UAT generated all four outputs, but the content failed the business quality gate:

- cross-output inconsistency: the Executive summary said Meta Ads lacked enough evidence while Strengths claimed strong click performance;
- unsupported inference: observed spend/click facts were interpreted as "large" and as evidence of planned investment without a baseline or planning-intent fact;
- data-readiness language leaked into Weaknesses/Recommendations as if it were a marketing-performance conclusion;
- placeholder/no-data ranked rows were still present in compact prompt evidence.

Notification remained disabled and no message was sent.

## Correction

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
5. Extend the existing native-action retry operator with a guarded quality-retry mode for the same generated 7D Executive UAT row. The mode resets the four AI outputs, writes the quality evidence, returns `generation_status` to `pending`, and uses one explicit retry marker in a single record update.
6. Notification Automation must remain inactive throughout.

## Safety

- AI engine / Automation creation: 0
- external model/API key: 0
- Report materialization: 0
- Remote D1: 0
- Queue / Worker: 0
- Schedule: disabled
- Production: BLOCKED
- quality repair write: exactly 1
- Notification send: 0
