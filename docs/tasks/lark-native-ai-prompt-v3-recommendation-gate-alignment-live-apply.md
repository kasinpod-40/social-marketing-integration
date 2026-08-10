# Lark Native AI Prompt v3 — Recommendation Decision Gate Alignment Live Apply

## Incident

Fresh Weekly Executive Decision Preview for `2026-08-03..2026-08-09` generated all four Native AI outputs, but the existing Decision Quality Gate rejected only `recommendations`:

```text
recommendations_missing_decision_actions
recommendations_missing_paid_action
recommendations_missing_ad_candidate
```

The generated recommendation text was generic by channel and did not emit the decision labels or a named Paid candidate required by the already-approved Executive Decision Quality Gate. `insight_summary`, `strengths` and `weaknesses` were generated and were not the source of this failure.

The failed Fresh identity is terminal evidence for this attempt. It must not be reset, cleared, recovered or retriggered.

## Existing Automation

Target only the already-existing active Automation:

`AI Materialization → MKT_AI_Report_Runs`

Do not create or replace an Automation. Do not touch `Eligible AI Run → Lark Group Notification`.

## Required manual change

Replace only the prompt text in the existing Native `AI-generated text` action that writes:

`recommendations`

Use exactly `LARK_NATIVE_AI_AUTOMATION_PROMPTS.recommendations.text` from:

`packages/config/src/lark-native-ai-automation-prompt-contract.js`

Keep the existing record-reference pills and output binding unchanged. Do not edit the `insight_summary`, `strengths` or `weaknesses` actions. Save and activate the same AI Automation after the Recommendations prompt matches the repository text.

The aligned Recommendations contract requires:

- every recommendation item to start with one approved decision label;
- a named Content candidate when Content candidates exist;
- a named Paid candidate when Paid candidates exist;
- `[SCALE]` only for the same Paid candidate whose evidence has `scale=1`;
- `[NO-SCALE]` when funnel evidence has both an up and a down metric;
- no generic channel-only Paid recommendation when named Ad candidates are present;
- no fabricated Organic↔Paid same-creative claim.

## Fresh identity

Repository contract `lark_weekly_7d_executive_decision_preview_v2` intentionally supersedes the generated quality-failed v1 identity. The new identity is derived without mutating the old row.

After the manual Recommendations prompt update and repository merge, run the normal Fresh Preview `--execute` only once on exact current `main`.

Do not use `--recover` for the generated quality-failed v1 row. Do not rerun the old identity.

## Safety

```text
Historical Weekly replay                   forbidden
Generated quality-failed Fresh v1 reset    forbidden
Generated quality-failed Fresh v1 retry    forbidden
New AI Automation                          0
Notification Automation mutation           0
Queue admission                            0 before accepted preview
Group message send                         0 before accepted preview
Schedule activation                        0
Production                                 BLOCKED
```
