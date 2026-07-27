# Archived Current Task — Chatwoot Integration Runtime Wiring

This archive records the authoritative repository result after PR #97 was Squash Merged.

```text
TASK_STATUS                         = MERGED_REMOTE_ROLLOUT_NOT_AUTHORIZED
CURRENT_PROGRAM                     = CHATWOOT_INTEGRATION_RUNTIME_WIRING
SOURCE_HEAD                         = ff1ea87472fced8a48c2551d66a100d2b59220fc
MERGED_PR                           = #97
MERGED_MAIN_SHA                     = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
MERGE_METHOD                        = SQUASH
MERGED_AT                           = 2026-07-27T14:15:29Z
MIGRATION_0017                      = APPLIED_OUTSIDE_WORKSTREAM / DO_NOT_RERUN
MIGRATION_0018                      = SOURCE_ONLY / NOT_APPLIED
REMOTE_ACTION_AUTHORIZED            = false
REMOTE_ACTIONS                      = NONE
PRODUCTION                          = BLOCKED
```

The merged repository implementation includes guarded Chatwoot runtime configuration, additive
Migration `0018_chatwoot_analytics.sql`, stable account-scoped Queue identity, Shared Reliability,
lock/generation/resumable-work integration, D1-before-Lark ordering, Coverage/checkpoint contracts,
15 logical Lark table keys and a top-level Chatwoot route.

All Chatwoot execution controls remain false by default. The merge did not deploy a Worker, apply
Migration `0018`, read a Customer Token, call Chatwoot, send a Queue message, mutate Remote Lark,
activate Schedule/Webhook, run Customer LIVE UAT or change Production.

Detailed contracts and evidence remain in:

```text
docs/tasks/chatwoot-end-to-end.md
docs/tasks/chatwoot-integration-wiring.md
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
docs/project-brain/chatwoot-runtime-wiring-2026-07-27.md
```
