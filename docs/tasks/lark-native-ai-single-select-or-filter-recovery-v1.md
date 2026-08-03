# Lark Native AI SingleSelect OR Filter Recovery v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_SINGLE_SELECT_OR_FILTER_RECOVERY_V1
BASE_MAIN_SHA                      = 17ef82692405eec9f25b07b4cf9e0afc8c5a06e2
FAILED_VIEW                        = ⚠️ Missing / Partial Data
ROOT_CAUSE                         = PROVEN_MUTATION_REPRESENTATION_DEFECT
LATEST_DIAGNOSTIC_WRITES           = 0
EXPECTED_RECOVERY_VIEW_UPDATES     = 1
FIELD_CREATE_UPDATE                = 0 / 0
RECORD_READ_WRITE                  = 0 / 0
PRODUCTION                         = BLOCKED
LIVE_RERUN                         = NOT_AUTHORIZED_BEFORE_MERGE
```

## Authoritative diagnostic evidence

The hard-read-only operator ran on clean exact `main@17ef82692405eec9f25b07b4cf9e0afc8c5a06e2` and returned:

```text
metadataReadCount      9
fieldCreateCount       0
fieldUpdateCount       0
viewCreateCount        0
viewUpdateCount        0
totalWriteCount        0
blockedRequestCount    0
```

The sanitized filter comparison proved:

```text
actual.conjunction                 and
actual.conditionCount              1
actual.totalValueCount             1
actual.fieldName                    readiness_status
actual.fieldType                    3
actual.operator                     is
expected.conditionCount            1
expected.totalValueCount            6
field/type/operator matches         true
value membership matches            false
condition grouping matches          false
```

The accepted six option IDs were sent in one `SingleSelect is` condition. Lark retained only one value. Option-ID resolution, Field identity, Field type and operator were correct.

## Correct encoding

The stable business condition remains `readiness_status in [six accepted states]`.

For Lark View OpenAPI this must be translated to six one-value conditions joined by `or`:

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

The repository continues to store stable option names. Each name resolves to exactly one current live option ID immediately before the PATCH.

## Bounded predecessor repair

The current non-empty View may be configured only when it is the exact collapsed predecessor of the corrected contract:

1. actual filter has exactly one condition;
2. expected filter has more than one condition and conjunction `or`;
3. actual and every expected condition use the same Field ID;
4. Field type is SingleSelect (`3`);
5. operator is `is`;
6. every condition contains exactly one scalar value;
7. expected values are unique;
8. the current one value is a member of the expected set.

Any other non-empty filter still fails with `LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT`.

## Implementation

- expand SingleSelect `in` values only under logical `any_of`;
- retain single-value `equals` behavior;
- reject unsupported SingleSelect multi-value `all_of` contracts;
- compare final read-back against six exact one-value conditions;
- retain sanitized conflict diagnostics;
- preserve hard diagnostic-only mode;
- add no new Remote endpoint or write class.

## Expected post-merge recovery

The next exact-main normal execution is expected to perform:

```text
fieldCreateCount                   0
fieldUpdateCount                   0
viewCreateCount                    0
viewUpdateCount                    1
totalWriteCount                    1
verification.status                zero_drift
remainingLogicalActionCount        0
requiredViewCount                  6
exactViewFilterCount               6
```

The live preflight is authoritative. A changed or unrelated filter must stop before mutation.

## Changed files

```text
packages/application/src/reports/lark-native-ai-schema-view-filters.js
tests/application/lark-native-ai-schema-view-filters.test.js
tests/application/lark-native-ai-schema-apply-option-id-resume.test.js
docs/project-brain/lark-native-ai-schema-select-filter-recovery.md
docs/tasks/lark-native-ai-single-select-or-filter-recovery-v1.md
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
Record read/write                  0 / 0
Table create/rename/delete         0
Field create/update/delete         0 / 0 / 0
View create/delete                 0 / 0
View update                        1 maximum after reviewed merge
Automation/Notification/AI         0
D1/Queue/Worker/Provider           0
Schedule/Production                BLOCKED
```
