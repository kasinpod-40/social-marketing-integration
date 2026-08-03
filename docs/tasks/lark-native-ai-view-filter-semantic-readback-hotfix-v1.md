# Lark Native AI View Filter Semantic Read-back Hotfix v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_VIEW_FILTER_SEMANTIC_READBACK_HOTFIX_V1
BASE_MAIN_SHA                      = cd92d61997aff9fac2ad44309c8e7cb74ce5ad73
SECOND_RESUME                      = FAIL_CLOSED_AFTER_ALL_REMAINING_WRITES
FAILED_STAGE                       = remote-additive-schema-apply
FAILED_CODE                        = LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT
FAILED_VIEW                        = ⚠️ Missing / Partial Data
FIELD_CREATE_UPDATE                = 0 / 0
VIEW_CREATE_UPDATE                 = 4 / 5
TOTAL_REMOTE_WRITES                = 9
RECORD_READ_WRITE                  = 0 / 0
DELETE_RENAME_TYPE_CHANGE          = 0
PRODUCTION                         = BLOCKED
LIVE_RERUN                         = NOT_AUTHORIZED
```

## Live evidence

The reviewed option-ID recovery operator ran on clean exact:

```text
main@cd92d61997aff9fac2ad44309c8e7cb74ce5ad73
```

It preserved the prior successful Field/Select state and completed the exact remaining write envelope:

```text
fieldCreateCount      0
fieldUpdateCount      0
viewCreateCount       4
viewUpdateCount       5
totalWriteCount       9
```

The operator then stopped during final View read-back planning at:

```text
code       LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT
viewName   ⚠️ Missing / Partial Data
```

This stop occurred after every remaining accepted View create/update request had returned success. Record access, Table mutation, delete/rename/type change, AI, Automation, notification, D1, Queue, Worker, Provider and Production actions remained zero.

The private evidence is retained at:

```text
outputs/lark-native-ai-schema-apply/apply-resume-20260803T012856Z.json
```

## Root cause

The Apply correctly translated stable Select option names to current live option IDs. The remaining defect is final read-back comparison treating presentation order as semantic identity.

`⚠️ Missing / Partial Data` is the only required View with:

- one filter condition;
- logical `any_of` / request conjunction `or`;
- multiple accepted Select option IDs inside that one `is` condition.

For a filter containing only one condition, `and` and `or` are semantically identical. Option IDs inside one accepted `is` condition are also an unordered set. Lark may canonicalize the conjunction and/or reorder option IDs during read-back.

The existing comparator required exact conjunction text and exact value-array order, producing a false conflict after successful writes.

## Correction

1. Normalize zero/one-condition filters to canonical conjunction `and` for comparison only.
2. Sort values within each condition canonically for comparison only.
3. Preserve the original reviewed mutation body and business contract.
4. Keep conjunction strict when two or more conditions exist.
5. Keep Field identity, Field type, operator and exact value membership strict.
6. Preserve missing/ambiguous option-ID and non-empty conflicting-filter fail-closed behavior.
7. Do not add any Remote write path.

## Expected post-merge recovery

Because the second resume already completed all remaining accepted writes, the next exact-main execution is expected to perform metadata reads only and return:

```text
mode                            already_zero_drift
plannedLogicalActionCount       0
appliedLogicalActionCount       0
remote.totalWriteCount          0
verification.status             zero_drift
remainingLogicalActionCount     0
requiredViewCount               6
exactViewFilterCount            6
```

The live preflight remains authoritative. Any real membership, Field, operator or multi-condition conjunction drift must still stop before writes.

## Changed files

```text
packages/application/src/reports/lark-native-ai-schema-view-filters.js
tests/application/lark-native-ai-schema-view-filters.test.js
docs/tasks/lark-native-ai-view-filter-semantic-readback-hotfix-v1.md
docs/project-brain/lark-native-ai-schema-select-filter-recovery.md
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-schema-view-filters.test.js
node --test tests/application/lark-native-ai-schema-apply-option-id-resume.test.js
node --test tests/application/lark-native-ai-schema-apply.test.js
node --test tests/scripts/lark-native-ai-schema-apply-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Hotfix Head.

## Safety

Repository implementation and CI perform zero Remote action. Do not rerun the Live operator until the Hotfix is reviewed and merged and a new exact-main command is issued.
