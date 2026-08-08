# Lark Native AI Prompt v3 — Executive Writer Contract

## Incident

Controlled 7D Executive Native Lark AI generation is technically stable, but live Prompt v2 still allows each output to drift across responsibilities:

- `insight_summary` can include recommendations;
- `weaknesses` can include missing-data/data-completeness commentary and recommendations;
- `recommendations` can repeat the Strengths fallback or recommend waiting for/filling data;
- four independently generated outputs can therefore read like a Data Quality report instead of one coherent weekly marketing report.

Quality-v4 evidence and the local post-generation gate exposed this remaining Prompt-layer defect. Notification stayed inactive and no message was sent.

## Correction

Replace Prompt v2 with writer-first Prompt v3 while preserving the same nine semantic reference slots and the same four Native Lark AI actions.

### Shared rules

- business-first Thai executive writing;
- facts only from validated evidence;
- null is never zero;
- increase/decrease/strong/weak/high/low/efficient/inefficient requires comparison, benchmark, or explicit rank evidence;
- missing data is never marketing performance;
- no internal status, system operations, JSON, field names, evidence footnotes, or Markdown headings;
- each output stays inside its assigned responsibility.

### Output responsibilities

- `insight_summary`: current facts and comparison-supported interpretation only; never actions/recommendations.
- `strengths`: only comparison/rank-supported positive performance; exact fallback when none exists.
- `weaknesses`: only comparison/rank-supported negative performance; exact fallback when none exists; never missing-data/data-completeness/action language.
- `recommendations`: only business actions derived from available business evidence; never repeat strengths/weaknesses, never data operations, never waiting/filling-data instructions.

## Live boundary

Repository changes do not mutate the Lark Automation. The four live Native AI action prompts must be replaced in the existing `AI Materialization → MKT_AI_Report_Runs` Automation and saved/activated before the controlled Prompt-v3 retry.

No Automation creation, Notification activation, Schedule change, D1/Queue/Worker action, or Production action is part of this change.
