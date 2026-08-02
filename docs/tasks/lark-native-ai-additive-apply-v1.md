# Lark Native AI Additive Schema Apply v1

## Status

`REPOSITORY_IMPLEMENTATION / REMOTE_APPLY_NOT_EXECUTED / PRODUCTION_BLOCKED`

## Reviewed Remote inventory authority

The read-only reviewed terminal completed on:

```text
Repository Head       f12a88e00417e76749e0f8ca9b314f7ee39e0117
Collected at          2026-08-02T16:41:50.080Z
Base identity SHA-256 7ad3bb5438302abcb6b198fe591abb33e142c2ed4919053d2b537961265cb56c
Inventory SHA-256     c25ac907bb7112d6dc4d712966aa1f1ce5f64ac91d01f51e486b1d7db6a7ad23
Tables                72
Target tables         1
Target existing fields 16
Target existing views  5
Token requests         1
Metadata reads         3
Blocked requests       0
Remote writes          0
Record reads           0
```

The exact target is:

```text
🧠 MKT_AI_Report_Runs
```

The reviewed Preview is:

```text
Add fields                23
Extend Select fields       2
Create Views               6
Total logical actions     31
Blockers                    0
Status                      ready_to_apply
Apply authorized            false
```

## Objective

Provide one exact-evidence, reviewed-main terminal capable of applying only the already-reviewed additive schema actions. Repository implementation and CI do not execute it. Live Apply remains a separate explicit operator action.

## Mutation contract

Allowed mutations:

1. Create the 23 missing fields in `🧠 MKT_AI_Report_Runs`.
2. Preserve every existing `platforms` option and append only `woocommerce` and `chatwoot` when missing.
3. Preserve every existing `report_type` option and append only `dashboard_channel_status` and `dashboard_executive_summary` when missing.
4. Create the six reviewed grid Views when missing.
5. Configure the five filtered Views with exact Field IDs/types resolved from current live metadata.
6. Replay the sanitized inventory collector and require `zero_drift`.

Forbidden mutations:

- Table create, rename or delete;
- Field rename, delete or type change;
- Select option removal;
- View delete;
- Record read or write;
- Lark Automation, Native AI or group notification;
- D1, Queue, Worker, Provider, Schedule or Production action.

## Exact execution gates

Execution requires all of the following before Lark authentication:

```text
branch = main
working tree = clean
HEAD = exact reviewed Apply Head
Remote inventory Evidence Head = exact configured SHA
Evidence Head is an ancestor of Apply Head
Evidence Base identity hash = exact configured SHA-256
Evidence inventory hash = exact configured SHA-256
Evidence action counts = 23 / 2 / 6 / 31
Evidence blockers = 0
Explicit confirmation = APPLY_LARK_NATIVE_AI_ADDITIVE_SCHEMA
```

The local Lark app token is SHA-256 bound to the same Base identity before the mutation client is created.

## Network allowlist

The terminal permits only:

```text
POST tenant_access_token
GET  tables metadata
GET  target fields metadata
GET  target views metadata
GET  exact target View metadata
POST target field create
PUT  exact target field update
POST target View create
PATCH exact target View update
```

Every other method/path is blocked before `fetch`, including all Record routes and delete operations.

## Field types

The Apply mapping uses the official Lark Bitable field type IDs already supported by the shared client:

```text
Text          1
Number        2
SingleSelect  3
MultiSelect   4
DateTime      5
Checkbox      7
```

Select options are created as `{ name }` entries. Existing options retain their current IDs, colors and order during extension. Date fields use `yyyy-MM-dd HH:mm` with `auto_fill=false`; Number uses `0.00`.

## View filters

```text
🌐 All Channel Readiness   all rows
📊 Executive Summaries    scope_type is [executive]
⚠️ Missing / Partial Data readiness_status is [report_partial, report_missing,
                            configuration_missing, source_unavailable,
                            not_observed, validation_failed]
✅ Notification Eligible  notification_eligible is [true]
                            AND preview_mode is [false]
❌ AI Generation Failures generation_status is [failed]
🧪 Preview Runs           preview_mode is [true]
```

The Lark request serializer receives only `field_id`, `operator` and JSON-array `value`; response-only `field_type` metadata is retained only for internal contract validation.

## Partial-stop and replay semantics

Before mutation, the current Target schema must be either:

- the exact reviewed inventory; or
- a monotonic subset of the reviewed 31 actions caused by a prior partial Apply.

Allowed partial state:

- original fields/views remain unchanged;
- created contract fields match the reviewed type and exact contract options;
- existing Select options remain and only reviewed additions may appear;
- only the six reviewed View names may be added.

Any unrelated Target field, option or View drift blocks before the next write. Field creates are checked by name before create and re-read after ambiguous create errors. View creates are checked by name before create and re-read after ambiguous create errors. Field updates are PUT-idempotent. Filtered Views are hydrated and verified after PATCH.

## Evidence output

Default private output:

```text
outputs/lark-native-ai-schema-apply/apply-summary.json
```

The file is mode `0600` and contains no credential, access token, Table ID, Field ID, View ID, Record value or raw HTTP body.

## Plan command

```bash
node scripts/lark-native-ai-additive-apply-reviewed-terminal.mjs
```

Plan mode performs zero Remote request and reports `executeAuthorized=false`.

## Reviewed execution shape

```bash
CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=APPLY_LARK_NATIVE_AI_ADDITIVE_SCHEMA \
MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD=<exact-reviewed-main-sha> \
MKT_LARK_NATIVE_AI_SCHEMA_EVIDENCE_HEAD=f12a88e00417e76749e0f8ca9b314f7ee39e0117 \
MKT_LARK_NATIVE_AI_REMOTE_INVENTORY_EVIDENCE=<inventory-summary.json> \
MKT_LARK_NATIVE_AI_EXPECTED_BASE_IDENTITY_HASH=7ad3bb5438302abcb6b198fe591abb33e142c2ed4919053d2b537961265cb56c \
MKT_LARK_NATIVE_AI_EXPECTED_INVENTORY_SHA256=c25ac907bb7112d6dc4d712966aa1f1ce5f64ac91d01f51e486b1d7db6a7ad23 \
node scripts/lark-native-ai-additive-apply-reviewed-terminal.mjs --execute
```

Do not run this command from a branch, dirty checkout or unreviewed Head.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-schema-preview.test.js
node --test tests/application/lark-native-ai-remote-inventory.test.js
node --test tests/application/lark-native-ai-additive-apply.test.js
node --test tests/scripts/lark-native-ai-remote-inventory-reviewed-terminal.test.js
node --test tests/scripts/lark-native-ai-additive-apply-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository verification performs zero Remote request and zero Live mutation.
