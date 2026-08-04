# Lark Notification Mapping Source Hotfix v1

Date: 2026-08-04

## Incident

The read-only notification Remote preflight stopped before any Remote command with:

```text
LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE
LARK_TABLE_MKT_AI_REPORT_RUNS
```

The table mapping already belongs to the existing merged local environment authority (`wrangler.sync.jsonc` plus `.dev.vars` plus explicit process environment), but the operator validated only literal Wrangler JSONC text.

## Root cause

The operator loaded `.dev.vars` and merged environment values for target selection, then discarded that merged environment before validating notification flags and required Lark table mappings. This produced false missing-mapping blockers one field at a time.

## Fix

- pass the existing merged environment through every rollout phase;
- validate all three notification flags across Wrangler and environment sources;
- accept each required table mapping from Wrangler or merged environment;
- fail closed when either source is empty/placeholder or when sources conflict;
- bind all four resolved mappings into a SHA-256 target fingerprint without exposing raw Table IDs;
- preserve the existing D1, Queue, Lark, Migration and evidence-chain boundaries.

## Safety

Repository-only hotfix. No Remote D1 read/write, Migration apply, Worker deployment, Queue send, Lark write, notification send, Automation activation, Schedule or Production action.
