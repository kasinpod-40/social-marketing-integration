# Lark Native AI View Filter Read-back Diagnostics v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_VIEW_FILTER_READBACK_DIAGNOSTICS_V1
BASE_MAIN_SHA                      = 78c1947fa525afb38b229c39f909e661d1a32e19
LIVE_STATE                         = ALL_ACCEPTED_WRITES_RETAINED
LATEST_REMOTE_WRITES               = 0
FAILED_CODE                        = LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT
FAILED_VIEW                        = ⚠️ Missing / Partial Data
ROOT_CAUSE                         = UNPROVEN
REPAIR_AUTHORITY                   = NONE
DIAGNOSTIC_NETWORK_MODE            = HARD_READ_ONLY
PRODUCTION                         = BLOCKED
```

## Evidence

The post-PR #441 exact-main verification performed only nine metadata reads and zero writes:

```text
metadataReadCount      9
fieldCreateCount       0
fieldUpdateCount       0
viewCreateCount        0
viewUpdateCount        0
totalWriteCount        0
```

It still stopped on `⚠️ Missing / Partial Data`. This disproves the claim that one-condition conjunction normalization and value ordering alone explain the Live difference.

## Goal

Expose the exact category of the remaining read-back mismatch without exposing or persisting infrastructure identities or filter values.

## Allowed diagnostics

On `LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT`, retain only:

- actual and expected conjunction;
- actual and expected condition count;
- accepted Field names resolved locally from live metadata;
- Field type;
- operator;
- value count;
- value scalar types;
- comparison Booleans for:
  - conjunction;
  - condition count;
  - Field set;
  - condition Field multiplicity;
  - Field type sequence;
  - operator sequence;
  - total value count;
  - flattened value membership;
  - condition grouping.

## Forbidden evidence

Never retain:

- Base app token;
- Table, Field, View or option IDs;
- raw filter values;
- raw HTTP request/response bodies;
- credentials or access tokens;
- Record data.

## Hard read-only diagnostic mode

The reviewed terminal accepts:

```text
MKT_LARK_NATIVE_AI_SCHEMA_APPLY_DIAGNOSTIC_ONLY=true
```

In this mode:

1. the application calls only `planLarkNativeAiSchemaAdditiveApply`;
2. the Fetch guard permits tenant token plus Table/Field/View metadata reads;
3. every Field or View write is blocked before `fetch` with
   `LARK_NATIVE_AI_SCHEMA_APPLY_DIAGNOSTIC_WRITE_BLOCKED`;
4. successful completion requires `totalWriteCount=0` and `blockedRequestCount=0`;
5. pending accepted actions cause a fail-closed diagnostic result and are never applied.

The post-merge diagnostic execution must use this mode. No repair, delete, recreate, rename or filter rewrite is authorized by this workstream.

## Changed files

```text
packages/application/src/reports/lark-native-ai-schema-view-filters.js
scripts/lib/lark-native-ai-schema-apply.js
scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs
tests/application/lark-native-ai-schema-view-filters.test.js
tests/scripts/lark-native-ai-schema-apply-reviewed-terminal.test.js
docs/tasks/lark-native-ai-view-filter-readback-diagnostics-v1.md
docs/project-brain/lark-native-ai-schema-select-filter-recovery.md
```

`docs/current-task.md` remains unchanged because another workstream owns it.

## Verification

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
View create/update/delete          0 / 0 / 0
AI/Automation/Notification         0
D1/Queue/Worker/Provider           0
Production                         BLOCKED
```
