# Lark Native AI Prompt v3 — Live Apply Checklist

## Existing Automation

Target only the already-existing active Automation:

`AI Materialization → MKT_AI_Report_Runs`

Do not create or replace an Automation. Do not touch `Eligible AI Run → Lark Group Notification`.

## Required manual change

Replace only the prompt text in the four existing Native `AI-generated text` actions:

1. `insight_summary`
2. `strengths`
3. `weaknesses`
4. `recommendations`

Keep each action's existing record-reference pills and output binding. Save and activate the same Automation after all four prompt texts match repository Prompt v3.

## Retry gate

After Prompt v3 is applied, run the controlled weekly retry with both confirmations:

- `CONFIRM_LARK_NATIVE_AI_PROMPTS_V3_APPLIED=LARK_NATIVE_AI_AUTOMATION_PROMPTS_V3_APPLIED`
- `CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_QUALITY_RETRY=RETRY_WEEKLY_7D_NATIVE_AI_PROMPT_V3`

The operator reuses retained `lark_ai_compact_quality_v4` evidence unchanged, clears only the four previous outputs plus generation state, triggers with one `failure_code`-only V7 write, and requires the expanded local Executive Writer Quality Gate to pass.

Notification remains inactive. Schedule remains disabled. Production remains blocked.
