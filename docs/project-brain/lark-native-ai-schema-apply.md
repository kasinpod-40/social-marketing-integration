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
```

## First Live Apply attempt — fail-closed

The reviewed operator ran from clean exact `main@5bdad6d930751a9e91351433309e76f364be92c4` and stopped at the first filtered View:

```text
stage                       remote-additive-schema-apply
action                      create_view
subject                     📊 Executive Summaries
causeCode                   LARK_PERMANENT_API_ERROR
appliedLogicalActionCount   0
```

Sanitized Remote counters:

```text
token requests              1
metadata reads             14
field creates               0
field updates               0
view creates                0
view updates                1
blocked requests            0
total writes                1
```

Record access, Table create/rename, Field delete, View delete, Automation, notification, AI, D1, Queue, Worker, Provider and Production actions remained zero.

The attempt proves that the accepted Fields/options and all six required View objects were already present. The remaining work is View-filter configuration. The failed request did not confirm a root cause; the leading hypothesis is that Update View requires the retained `view_name` together with `property.filter_info`, while the Apply use case passed only the filter mutation.

Repository hotfix scope is recorded in:

```text
docs/tasks/lark-native-ai-view-filter-patch-hotfix-v1.md
```

Live rerun is blocked until that hotfix is reviewed and merged.

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

Default mode is plan-only. Remote Apply requires exact clean reviewed `main`, retained evidence and explicit confirmation. The failed first Live attempt does not authorize a rerun on the unchanged operator.

Full contract:

```text
docs/tasks/lark-native-ai-schema-additive-apply-v1.md
```

## Parallel-workstream boundary

`docs/current-task.md` remains owned by the active Chatwoot recovery workstream. PR #421 Meta files
are not modified. This workstream changes only Lark Native AI schema-Apply code, focused tests and
modular documentation.
