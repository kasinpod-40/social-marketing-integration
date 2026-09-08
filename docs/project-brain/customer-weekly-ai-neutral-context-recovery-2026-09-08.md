# Customer Weekly AI Neutral-context Recovery — 2026-09-08

## Verified incident

Customer Weekly 7D Report materialization for period end `2026-09-06` completed for all eight active channels.
The automatic Weekly operation stopped before Notification admission with
`LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED`. D1 contains no delivery row for this period, so no Lark group
message was sent.

An isolated Customer Worker Preview read only the exact generated AI row and returned hashes, lengths and quality
codes without returning business text. It used zero D1/Lark writes, zero Queue messages, zero Notification sends
and zero Production traffic. Preview URLs were restored disabled after each read.

```text
period_end                = 2026-09-06
source_report_count       = 8
generation_status         = generated
quality_violation_count   = 1
quality_violation         = strengths_contains_neutral_metric
```

All other quality checks passed, including required positive/negative evidence, cross-channel coverage, named
Content/Paid candidates and labeled decision actions. The defect is therefore an over-broad validator rule: it
rejected any neutral metric name inside `strengths`, even when the same text contained the required positive
channel and metric and used the neutral value only as context.

## Reviewed repair and recovery boundary

The quality gate continues to require an evidence-backed positive channel and positive metric in `strengths`.
It no longer creates an independent failure merely because a neutral metric is also mentioned. Every other
quality rule remains unchanged.

After reviewed merge and Customer deploy, recover only exact operation `weekly-executive-auto-20260906` with its
retained Work/generation after confirming lock zero and no existing delivery. Completion requires one D1 delivery
with `status=sent`, `claim_count=1`, `mirror_status=mirrored`, exactly one Lark group message and zero duplicate.
Do not create a replacement Weekly identity and do not use generic DLQ redrive.

The first guarded same-generation replay after deploy proved another independent recovery boundary: normal source
collection intentionally chose the newest available Weekly period, which had advanced beyond `2026-09-06`.
Automatic Weekly processing now passes its retained `periodEnd` into source collection. This selects the exact
historical snapshot set for a reviewed retry while all callers without an explicit target retain newest-period
behavior. The failed attempt created no Notification delivery or group message and must not be replayed again.

The following guarded replay proved one more bounded-read condition: the broad `report_setting_key` search no
longer returned the older target because newer snapshots filled its result window. When `periodEnd` is explicit,
the collector must therefore query `MKT_Report_Snapshots.period_end` at Bangkok midnight server-side and only
then validate Customer profile, enabled setting, Report type and seven-day window. This changes no ordinary
newest-period caller and does not create a new report or Notification identity.

The first direct query used the generic text-field equality helper and live Lark rejected it with
`1254018 InvalidFilter`; no delivery or message was created. The valid exact-DateTime contract is the same range
form already used by production report sources: `period_end >= Bangkok midnight` and `period_end < next Bangkok
midnight`, bounded to at most 500 returned rows before the existing authority filters run.
