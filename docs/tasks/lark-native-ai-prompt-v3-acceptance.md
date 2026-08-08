# Lark Native AI Prompt v3 Acceptance

Prompt-v3 quality passes only when the controlled 7D Executive retry produces all four outputs and the local gate reports `passed=true`.

Required boundaries:

- Summary contains no action/recommendation language.
- Summary names at least one business-evidence channel and includes a real numeric fact when numeric evidence exists.
- Strengths uses the exact no-comparison fallback when comparison evidence is absent.
- Weaknesses contains neither action language nor data-completeness/missing-channel language.
- Recommendations contains neither Strengths/Weaknesses fallback text, headings, missing-data language nor Data Ops actions.
- Observed-only Paid Ads follow-up stays business-focused (CTR/CPC/baseline/creative/next-period comparison).
- No internal status language, Markdown heading or evidence footnote.
- Notification remains inactive, `notification_eligible=false`, `sent_to_group=false`, Schedule disabled, Production blocked.
