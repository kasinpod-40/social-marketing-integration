# Lark Native AI SingleSelect OR Execution v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_SINGLE_SELECT_OR_EXECUTION_V1
BASE_MAIN_SHA                      = efa5f9e11f2137f2fa74654cf5bc8d9fdedca6cc
PR_443_MUTATION_CONTRACT           = MERGED
EXECUTION_RECHECK_GAP              = CONFIRMED_REPOSITORY_DEFECT
LIVE_ACTION                        = NOT_RUN
EXPECTED_VIEW_UPDATE               = 1
MAXIMUM_VIEW_UPDATE                = 1
FIELD_CREATE_UPDATE                = 0 / 0
RECORD_READ_WRITE                  = 0 / 0
PRODUCTION                         = BLOCKED
```

## Context

PR #443 merged the proven corrected Lark representation for `⚠️ Missing / Partial Data`:

```text
OR(
  readiness_status is [option 1],
  readiness_status is [option 2],
  readiness_status is [option 3],
  readiness_status is [option 4],
  readiness_status is [option 5],
  readiness_status is [option 6]
)
```

Its planner recognizes the exact Live collapsed predecessor—one accepted SingleSelect value retained from the earlier six-value condition—and classifies only that shape as `configure`.

Before authorizing the post-merge operator, review found that the execution loop performed its own immediate `getView` recheck but still allowed only an empty filter. A non-empty exact predecessor would therefore be rejected before PATCH even after the planner approved it.

No Live command was issued after discovering this gap.

## Correction

The execution loop now:

1. hydrates the View immediately before PATCH;
2. normalizes the filter using the same semantic representation as the planner;
3. accepts exact parity without writing;
4. accepts an empty filter for existing additive create/configure behavior;
5. accepts the exact bounded collapsed SingleSelect predecessor;
6. rejects every other non-empty filter before PATCH;
7. performs the already-reviewed six-condition OR mutation;
8. verifies final inventory and all six View filters at zero drift.

## Race protection

A dedicated regression changes the View after planning but before the execution recheck. When the single value is no longer a member of the accepted six-option set, execution returns `LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT` and records:

```text
fieldCreateCount      0
fieldUpdateCount      0
viewCreateCount       0
viewUpdateCount       0
```

This proves planner approval cannot authorize a later unrelated filter overwrite.

## Successful recovery regression

A second end-to-end regression begins with:

- all accepted Fields and Select options complete;
- all six required Views present;
- five View filters exact;
- `⚠️ Missing / Partial Data` retaining one accepted predecessor value.

Expected result:

```text
mode                            resume_apply
plannedLogicalActionCount       1
appliedLogicalActionCount       1
fieldCreateCount                0
fieldUpdateCount                0
viewCreateCount                 0
viewUpdateCount                 1
verification.status             zero_drift
remainingLogicalActionCount     0
requiredViewCount               6
exactViewFilterCount            6
```

## Changed files

```text
packages/application/src/reports/apply-lark-native-ai-schema.js
tests/application/lark-native-ai-schema-apply-option-id-resume.test.js
docs/tasks/lark-native-ai-single-select-or-execution-v1.md
```

`docs/current-task.md` remains unchanged because another workstream owns it.

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

## Safety

```text
Repository Remote action             0
Record read/write                    0 / 0
Table create/rename/delete           0
Field create/update/delete           0 / 0 / 0
View create/delete                   0 / 0
Post-merge View update               1 maximum
AI/Automation/Notification           0
D1/Queue/Worker/Provider             0
Schedule/Production                  BLOCKED
```
