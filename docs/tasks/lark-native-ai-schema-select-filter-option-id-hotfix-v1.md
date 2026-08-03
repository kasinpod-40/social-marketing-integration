# Lark Native AI Schema Select Filter Option-ID Hotfix v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_SCHEMA_SELECT_FILTER_OPTION_ID_HOTFIX_V1
BASE_MAIN_SHA                      = 5bdad6d930751a9e91351433309e76f364be92c4
PARTIAL_APPLY                      = RETAINED_SAFE
FIELD_CREATE_SUCCEEDED             = 23
FIELD_UPDATE_SUCCEEDED             = 2
VIEW_CREATE_SUCCEEDED              = 2
VIEW_UPDATE_SUCCEEDED              = 1
TOTAL_REMOTE_WRITES                = 28
FAILED_VIEW                        = 📊 Executive Summaries
FAILED_ACTION                      = create_view
FAILED_CAUSE                       = LARK_PERMANENT_API_ERROR
RECORD_READ_WRITE                  = 0 / 0
DELETE_RENAME_TYPE_CHANGE          = 0
PRODUCTION                         = BLOCKED
```

## Incident evidence

The reviewed additive Apply ran on clean exact `main@5bdad6d930751a9e91351433309e76f364be92c4` and stopped during the View phase after completing the accepted Field phase.

Observed Remote counters:

```text
tokenRequestCount     1
metadataReadCount    14
fieldCreateCount     23
fieldUpdateCount      2
viewCreateCount       2
viewUpdateCount       1
blockedRequestCount   0
totalWriteCount      28
```

The following successful mutations are authoritative and must be preserved:

- 23 additive Fields;
- two additive Select option extensions;
- the two created Views;
- the successfully configured View filter.

No rollback, delete, rename, Field type mutation, option removal or replacement Apply is authorized.

## Root cause

The business View contract is intentionally expressed with stable Select option names such as `executive`, `report_partial` and `failed`.

The Apply v1 implementation copied those names directly into Lark View PATCH filter values. Lark View filter metadata and the existing shared client contract use the live Select option IDs in the JSON-array value. As a result, the first filtered Select View PATCH was rejected with `LARK_PERMANENT_API_ERROR`.

The shared Lark client serializer itself was correct. The defect was the schema Apply translation layer between name-based business contract and ID-based live View mutation.

## Correction

The Hotfix adds one dedicated View-filter resolver that:

1. keeps the business contract name-based;
2. reads current live Field metadata already required by the Apply preflight;
3. resolves every SingleSelect/MultiSelect name to exactly one live option ID;
4. preserves Boolean values for Checkbox filters;
5. fails closed when an option name is missing or maps ambiguously;
6. compares read-back filters using exact option IDs;
7. preserves all existing partial-resume and zero-drift gates.

No raw Table, Field, View or option ID is persisted in public evidence.

## Exact resume contract

A rerun must first re-read current metadata and prove the current target is an accepted additive descendant of the retained inventory.

Given the observed retained partial state and no external drift, the expected remaining logical work is:

```text
Field create/update       0
Existing View configure   1
Remaining View create     4
Filtered View updates     5
Remaining logical actions 5
```

The counts above are expectations, not authority. The live preflight must derive the current subset again and may stop with zero writes if any unaccepted drift or conflicting View filter exists.

A successful resume must end with:

```text
mode                            resume_apply
verification.status             zero_drift
remainingLogicalActionCount     0
requiredViewCount               6
exactViewFilterCount            6
recordReadCount                 0
tableCreateCount                0
tableRenameCount                0
fieldDeleteCount                0
viewDeleteCount                 0
automationCreateCount           0
notificationSendCount           0
aiCallCount                     0
remoteD1QueueWorkerProvider     0
production                      BLOCKED
```

## Safety boundary

Allowed Remote requests remain limited to the exact target table metadata plus additive Field/View endpoints already reviewed by PR #438.

Forbidden:

- Record reads or writes;
- Table create, rename or delete;
- Field delete or type change;
- Select option removal;
- View delete;
- AI generation;
- Lark Automation or Group Notification;
- D1, Queue/DLQ, Worker, Provider, Schedule/Webhook or Production action.

## Verification

Required repository gates:

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-schema-apply.test.js
node --test tests/application/lark-native-ai-schema-view-filters.test.js
node --test tests/connectors/lark-bitable-client.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass on the exact Hotfix Head before a Remote resume command is issued.

Repository implementation performs zero Remote mutation.