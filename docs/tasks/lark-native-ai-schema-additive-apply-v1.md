# Lark Native AI Schema Additive Apply v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_SCHEMA_ADDITIVE_APPLY_V1
BRANCH                             = implementation/lark-native-ai-schema-additive-apply-v1
BASE_MAIN_SHA                      = f12a88e00417e76749e0f8ca9b314f7ee39e0117
REMOTE_INVENTORY                   = COMPLETE
REMOTE_SCHEMA_APPLY                = NOT_RUN
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
LOGICAL_ACTIONS                    = 31
MAX_REMOTE_WRITE_REQUESTS          = 36
RENAME_DELETE_TYPE_CHANGE          = FORBIDDEN
RECORD_READ                        = FORBIDDEN
AUTOMATION_NOTIFICATION_AI         = FORBIDDEN
REMOTE_D1_QUEUE_WORKER_PROVIDER    = 0
PRODUCTION                         = BLOCKED
```

## Accepted Remote authority

The operator is bound to the successful metadata-only inventory collected from exact clean
`main@f12a88e00417e76749e0f8ca9b314f7ee39e0117`.

```text
inventory SHA-256
c25ac907bb7112d6dc4d712966aa1f1ce5f64ac91d01f51e486b1d7db6a7ad23

Base identity hash
7ad3bb5438302abcb6b198fe591abb33e142c2ed4919053d2b537961265cb56c

physical Tables       72
target Fields         16
target Views           5
planner status         ready_to_apply
planner blockers       0
```

The retained evidence must remain a private `0600` JSON file at:

```text
outputs/lark-native-ai-remote-inventory/inventory-summary.json
```

No Remote ID or credential is copied into Repository source or test fixtures.

## Objective

Create one reviewed Terminal authority that applies only the exact additive schema plan already
proved by the Remote read-only inventory:

```text
23 add Field actions
 2 extend Select option actions
 6 create/configure View actions
31 logical actions
```

The six View actions require at most five additional `PATCH` requests because the existing Lark
client creates a View first and installs its filter separately. Therefore the exact logical plan is
31 actions while the bounded HTTP write ceiling is 36.

## Additive-only contract

Allowed Remote writes are limited to:

```text
POST  target Table /fields
PUT   target Table /fields/{field_id}
POST  target Table /views
PATCH target Table /views/{view_id}
```

Forbidden:

```text
create/rename/delete Table
delete Field
change Field type
delete View
remove Select option
read/write Record
Automation
notification
Lark Native AI call
D1
Queue/DLQ
Worker deployment
Provider
Schedule/Webhook
Production
```

Every request passes through a method-and-path allowlist before network.

## Retained evidence validation

Before any Remote write, the operator independently verifies:

1. exact accepted retained contract version;
2. exact retained clean-main Head;
3. exact inventory SHA and a fresh SHA-256 recomputation from inventory content;
4. exact Base identity hash;
5. exact 72-Table inventory and one target Table;
6. exact 16 existing target Fields and five existing Views;
7. recomputed Preview equals the retained 31 actions;
8. Remote inventory request counters are `1 token / 3 metadata / 0 blocked`;
9. prior inventory safety counters are zero and `applyAuthorized=false`;
10. retained inventory Head is an ancestor of the current reviewed Apply Head.

## Current-state drift contract

The live Base immediately before Apply must be either:

```text
fresh exact accepted inventory
or
an additive descendant produced by a prior partial attempt
```

The descendant rule requires:

- the current Base token hash remains the accepted Base identity;
- the exact target Table remains unique; unrelated Tables may evolve independently;
- every pre-existing target Field remains present with the same type;
- every pre-existing Select option remains present;
- new Fields are limited to the 23 approved Fields with approved types/options;
- added options are limited to the two approved extensions;
- pre-existing Views remain present;
- new Views are limited to the six approved Views;
- the current planner action set is a subset of the accepted 31 actions;
- a required View filter is either exact or empty; a conflicting filter blocks before writes.

## Partial retry

The operator is idempotent across ambiguous/partial Lark responses:

- a Field already created with an accepted type is not created again;
- an option already added is not added again;
- a View already created with an exact filter is reused;
- a View created before its filter completed may receive only the accepted filter;
- a View with any conflicting filter fails closed;
- final read-back must reach planner `zero_drift` and exact filter parity for all six Views.

## Repository gate

Remote execution requires:

```text
branch = main
working tree = clean
HEAD = exact reviewed 40-character SHA
accepted inventory Head is an ancestor of HEAD
exact confirmation value
```

Plan-only command:

```bash
node scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs
```

Reviewed Apply command after merge:

```bash
CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=APPLY_LARK_NATIVE_AI_SCHEMA_31_ACTIONS \
MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs --execute
```

The Repository implementation and CI do not run this command.

## Evidence

Success or partial failure writes sanitized private evidence to:

```text
outputs/lark-native-ai-schema-apply/apply-summary.json
```

Evidence contains names, action states, counts and checksums only. It contains no App token,
tenant token, Table ID, Field ID, View ID, request body, Record data or raw URL.

## Changed files

```text
packages/config/src/lark-native-ai-schema-apply-contract.js
packages/application/src/reports/apply-lark-native-ai-schema.js
packages/application/src/reports/lark-native-ai-schema-apply-evidence.js
packages/application/src/reports/lark-native-ai-schema-apply-model.js
scripts/lib/lark-native-ai-schema-apply.js
scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs
tests/fixtures/lark-native-ai-schema-apply-accepted-inventory.json
tests/application/lark-native-ai-schema-apply.test.js
tests/scripts/lark-native-ai-schema-apply-reviewed-terminal.test.js
docs/tasks/lark-native-ai-schema-additive-apply-v1.md
docs/project-brain/lark-native-ai-schema-apply.md
```

`docs/current-task.md`, PR #421 files, Worker runtime, Report runtime and Business facts are unchanged.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-schema-preview.test.js
node --test tests/application/lark-native-ai-remote-inventory.test.js
node --test tests/application/lark-native-ai-schema-apply.test.js
node --test tests/scripts/lark-native-ai-remote-inventory-reviewed-terminal.test.js
node --test tests/scripts/lark-native-ai-schema-apply-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the
exact PR Head. Repository verification performs zero Remote action.
