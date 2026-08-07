# Lark Native AI Weekly 7D Input-Length Hotfix v1

## Current verified incident

The first real `weekly_executive_quality_v2_uat` run reached the existing active `AI Materialization → MKT_AI_Report_Runs` Automation on 2026-08-08 and failed in the first native AI action with `The input length exceeds the limit in AI-generated text.`

The exact UAT row remained `generation_status=pending`, `preview_mode=true`, `notification_eligible=false`, `sent_to_group=false`. Notification Automation remained inactive. No Group message was sent.

## Decision

Keep the existing business-first Prompt v2, Report facts, AI Run identity and Lark Automations. Do not create a replacement AI engine or Automation.

Compact only the prompt evidence carried by the isolated weekly Executive UAT row. Preserve all nine channels, bounded current/previous metrics, Top Content, Top Ads and bounded dimensional collections while removing duplicate internal metadata and verbose nested fields. Enforce deterministic prompt-input budgets and fail closed if they cannot be met.

The post-merge one-shot repair operator may update that exact UAT row once and use the existing `failure_code` update trigger for one real AI retry. Notification must remain inactive throughout the retry.
