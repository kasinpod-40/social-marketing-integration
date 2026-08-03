# Lark Native AI View Filter PATCH Hotfix v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_VIEW_FILTER_PATCH_HOTFIX_V1
BASE_MAIN_SHA                      = 5bdad6d930751a9e91351433309e76f364be92c4
LIVE_ATTEMPT                       = FAIL_CLOSED
LIVE_STAGE                         = remote-additive-schema-apply
LIVE_ACTION                        = create_view / 📊 Executive Summaries
REMOTE_VIEW_PATCH_REQUESTS         = 1
REMOTE_VIEW_PATCH_SUCCESS_PROOF    = 0
FIELD_CREATE                       = 0
FIELD_UPDATE                       = 0
VIEW_CREATE                        = 0
RECORD_READ                        = 0
D1_QUEUE_WORKER_PROVIDER           = 0
PRODUCTION                         = BLOCKED
LIVE_RERUN                         = NOT_AUTHORIZED
```

## Live evidence

The reviewed additive schema operator passed the exact retained-evidence, repository, Base identity and plan-only gates on clean `main@5bdad6d930751a9e91351433309e76f364be92c4`.

The Remote execution then stopped fail-closed at the first filtered View:

```text
stage                       remote-additive-schema-apply
code                        LARK_NATIVE_AI_SCHEMA_APPLY_REMOTE_ACTION_FAILED
causeCode                   LARK_PERMANENT_API_ERROR
action                      create_view
subject                     📊 Executive Summaries
appliedLogicalActionCount   0
```

Sanitized request counters:

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

`viewUpdateCount=1` proves that one PATCH request was attempted. Because Lark returned a permanent API error, it is not evidence that the View filter mutation succeeded. A fresh metadata read during the next reviewed resume must determine the actual state.

All Record, Table create/rename, Field delete, View delete, Automation, notification, AI, D1, Queue, Worker, Provider and Production counters remained zero.

The `viewCreateCount=0` and first action subject show that the six required View objects and all accepted additive Fields/options were already present when this attempt ran. The remaining operation was filter configuration on an existing empty View.

## Diagnosis boundary

The generic permanent API classification is not sufficient to claim an exact root cause. The current leading hypothesis is that the Update View request omitted the existing `view_name` and sent only `property.filter_info`.

The shared Lark client already supports serializing `view_name`, but the schema Apply use case did not pass it. The hotfix therefore preserves the existing View name in every filter PATCH. Live success is still required before this hypothesis may be promoted to a confirmed root cause.

## Repository correction

1. Pass the exact existing `viewName` to `client.updateView` together with the reviewed filter mutation.
2. Preserve the existing method/path allowlist and the zero Record-access boundary.
3. Keep filter values and Field/View/Table identities out of retained failure evidence.
4. Surface only sanitized Remote diagnostics:
   - HTTP status;
   - Lark error code;
   - whether `view_name` and `filter_info` were present;
   - filter conjunction, condition count and operator names.
5. Add a regression that requires the View name on PATCH and proves diagnostics exclude IDs and filter values.
6. Preserve exact partial-resume and zero-write replay behavior.

## Changed files

```text
packages/application/src/reports/apply-lark-native-ai-schema.js
tests/application/lark-native-ai-schema-apply.test.js
docs/tasks/lark-native-ai-view-filter-patch-hotfix-v1.md
docs/project-brain/lark-native-ai-schema-apply.md
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-schema-apply.test.js
node --test tests/scripts/lark-native-ai-schema-apply-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must also pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Hotfix Head.

## Safety

Repository implementation and CI perform no Remote Lark request. Do not rerun the Live Apply until the hotfix is reviewed, merged, and a new exact-main operator command is issued. The next live attempt must use the same retained evidence and rely on the existing partial-resume guards; it must not recreate accepted Fields, options or Views.
