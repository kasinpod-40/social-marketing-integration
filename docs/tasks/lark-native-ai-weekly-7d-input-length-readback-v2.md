# Lark Native AI Weekly 7D Input-Length Readback Hotfix v2

## Incident

The first post-merge retry operator stopped at `compact-business-evidence` with `LARK_AI_INPUT_LENGTH_REPAIR_NOT_SMALLER` before any Lark record write.

Observed diagnostics reported both original evidence lengths as exactly `15`, while the compacted evidence was `1957` and `589` characters. The value `15` matches JavaScript string coercion of a Lark object-shaped Text value (`[object Object]`).

## Root cause

The operator correctly normalized Lark Text fields through `requireText` / `optionalText` before passing them to the compactor, but measured the original values separately with `String(fields.<name>).length`. For object-shaped Lark Text responses this measured the wrapper object rather than the actual text payload.

## Correction

Reuse the same normalized text values for both compaction input and the `before` length comparison. Do not change compaction policy, AI prompt, Automation identity, retry marker, Report facts, or notification safety.

## Safety

- Remote record writes during the failed attempt: `0`
- Notification count: `0`
- Schedule enabled: `false`
- Production: `BLOCKED`
- Post-merge retry remains limited to the same exact pending weekly Executive UAT row and one record write.

## Regression

A focused source-contract regression requires normalized variables for both evidence fields and rejects direct `String(fields.metric_summary_json)` / `String(fields.channel_status_vector_json)` length measurement.
