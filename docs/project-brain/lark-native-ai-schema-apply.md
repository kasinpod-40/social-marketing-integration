# Project Brain — Lark Native AI Schema Additive Apply

## Current authority

The Integration Workspace Remote metadata inventory completed successfully on:

```text
main                              f12a88e00417e76749e0f8ca9b314f7ee39e0117
target Table                      🧠 MKT_AI_Report_Runs
inventory SHA-256                 c25ac907bb7112d6dc4d712966aa1f1ce5f64ac91d01f51e486b1d7db6a7ad23
Base identity hash                7ad3bb5438302abcb6b198fe591abb33e142c2ed4919053d2b537961265cb56c
physical Tables                   72
planner actions                   31
planner blockers                  0
status                            ready_to_apply
Remote Lark write                 0
```

## Apply boundary

The reviewed Apply workstream is additive-only:

```text
23 Fields
 2 Select option extensions
 6 Views
31 logical actions
36 maximum Remote write requests
```

The difference between 31 logical actions and 36 HTTP writes is deliberate: five filtered Views
require one create request and one filter-update request. `🌐 All Channel Readiness` is an all-row
View and requires no filter update.

No Table create/rename/delete, Field delete/type change, option removal, View delete, Record access,
Automation, notification, AI call, D1, Queue, Worker, Provider, Schedule or Production action is
reachable.

## Safety and retry

Before writing, the operator validates the exact retained inventory content, Base identity,
repository ancestry and current live metadata. The current Base must be the exact accepted
inventory or an additive descendant of it.

Partial retry is allowed only when completed state is a subset of the accepted 31 actions.
Existing required View filters must be exact or empty; conflicting filters block. Final completion
requires both planner `zero_drift` and exact six-View filter parity.

## Operator

```text
scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs
```

Default mode is plan-only. Remote Apply remains unperformed until the implementation PR is merged
and the operator is run from exact clean reviewed `main` with explicit confirmation.

Full contract:

```text
docs/tasks/lark-native-ai-schema-additive-apply-v1.md
```

## Parallel-workstream boundary

`docs/current-task.md` remains owned by the active Chatwoot recovery workstream. PR #421 Meta files
are not modified. This workstream changes only Lark Native AI schema-Apply code, focused tests and
modular documentation.
