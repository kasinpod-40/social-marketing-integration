# Lark Native AI Remote Inventory v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_REMOTE_INVENTORY_V1
BRANCH                             = implementation/lark-native-ai-remote-inventory-v1
BASE_MAIN_SHA                      = fffa218e2ab12235883b624793dfb53673a5a2c4
PHASE_1_SCHEMA_PREVIEW             = MERGED
REMOTE_EXECUTION                   = NOT_RUN
REMOTE_MODE                        = METADATA_READ_ONLY
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
RECORD_READ                        = FORBIDDEN
REMOTE_LARK_WRITE                  = FORBIDDEN
SCHEMA_APPLY                       = NOT_AUTHORIZED
LARK_NATIVE_AI_CALL                = 0
AUTOMATION                         = 0
NOTIFICATION_SEND                  = 0
REMOTE_D1_QUEUE_WORKER_PROVIDER    = 0
PRODUCTION                         = BLOCKED
```

## Objective

Add one reviewed-terminal operator that reads the current Integration Workspace Lark Base metadata needed by the already-merged additive schema planner.

The collector must determine whether the exact live Base still requires:

```text
23 additive fields
2 Select-option extensions
6 Views
```

or whether live drift changes that plan. It must not apply any action.

## Authority

Phase 1 merged at:

```text
main@fffa218e2ab12235883b624793dfb53673a5a2c4
```

The merged planner remains the only schema-diff authority:

```text
packages/config/src/lark-native-ai-schema-preview.js
```

The Remote collector only creates sanitized inventory and feeds that inventory into the planner.

## Remote request allowlist

The network guard permits exactly:

1. `POST /open-apis/auth/v3/tenant_access_token/internal`;
2. `GET .../tables`;
3. `GET .../tables/{table_id}/fields`;
4. `GET .../tables/{table_id}/views`.

Every other method or path is rejected before the underlying `fetch` call.

Forbidden examples:

```text
POST/PATCH/PUT/DELETE Base metadata
Create or update Field
Create or update View
Create or rename Table
Record search/list/read
Batch create/update/delete
Automation access
Notification access
AI access
```

## Repository gate

Remote execution requires all conditions:

```text
branch = main
working tree = clean
HEAD = exact reviewed 40-character SHA
explicit confirmation = present
```

Required environment:

```text
CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY=READ_LARK_NATIVE_AI_REMOTE_INVENTORY
MKT_LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha>
```

The operator loads Lark credentials only from local environment, ignored `wrangler.sync.jsonc`, or ignored `.dev.vars`. No credential is written to output.

## Sanitized evidence

Persisted evidence contains:

- Repository branch and exact reviewed Head;
- SHA-256 hash of the Base app token, never the token itself;
- Base display name when configured;
- all Table names needed to prove exact target-table cardinality;
- target Field names, canonical types and Select option names;
- target View names;
- deterministic inventory SHA-256;
- additive schema Preview actions/blockers;
- token-auth and metadata-read request counts;
- zero-mutation safety counters.

Persisted evidence excludes:

```text
app ID
app secret
app token
access token
Table IDs
Field IDs
View IDs
Record values
raw HTTP URL/body/headers
```

Evidence path defaults to:

```text
outputs/lark-native-ai-remote-inventory/inventory-summary.json
```

The file is written with mode `0600`; `/outputs` is repository-ignored.

## Target-table collection behavior

1. Read all Table metadata.
2. Match exact name `🧠 MKT_AI_Report_Runs`.
3. When count is zero or greater than one, stop detailed reads and let the planner return a target identity blocker.
4. When count is exactly one, read only that Table's Fields and Views.
5. Convert only supported contract types:
   - Text;
   - Number;
   - SingleSelect;
   - MultiSelect;
   - DateTime;
   - Checkbox.
6. Unsupported type fails closed.
7. Select options absent from metadata remain unknown and create `SELECT_OPTIONS_UNAVAILABLE`; they are never treated as an empty option set.
8. No View hydration is needed because Phase 1 planning compares View names only.

## Plan command

```bash
node scripts/lark-native-ai-remote-inventory-reviewed-terminal.mjs
```

Plan mode performs zero external request.

## Reviewed execution command after merge

```bash
CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY=READ_LARK_NATIVE_AI_REMOTE_INVENTORY \
MKT_LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/lark-native-ai-remote-inventory-reviewed-terminal.mjs --execute
```

`--apply` is always rejected with:

```text
LARK_NATIVE_AI_SCHEMA_APPLY_NOT_AUTHORIZED
```

## Expected current result

The prior Base artifact audit predicted:

```text
Target table count          1
Add fields                 23
Extend Select options       2
Create Views                6
Total actions              31
Blockers                     0
Status                       ready_to_apply
```

The Remote read-only run must be treated as the current authority. A different action count is evidence of live drift, not an automatic error and not Apply permission. Any blocker remains fail-closed.

## Changed files

```text
packages/application/src/reports/collect-lark-native-ai-schema-inventory.js
scripts/lib/lark-native-ai-remote-inventory.js
scripts/lark-native-ai-remote-inventory-reviewed-terminal.mjs
tests/application/lark-native-ai-remote-inventory.test.js
tests/scripts/lark-native-ai-remote-inventory-reviewed-terminal.test.js
docs/tasks/lark-native-ai-remote-inventory-v1.md
docs/project-brain/lark-native-ai-remote-inventory.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-all-channel-preview.test.js
node --test tests/application/lark-native-ai-schema-preview.test.js
node --test tests/application/lark-native-ai-remote-inventory.test.js
node --test tests/scripts/lark-native-ai-remote-inventory-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head.

## Definition of Done

Repository implementation is complete when:

- exact metadata allowlist is enforced before network;
- target table identity is fail-closed;
- IDs and credentials are absent from evidence;
- output is compatible with the merged schema planner;
- exact 31-action fixture and zero-drift replay pass;
- Apply and Record reads are unreachable;
- full Branch Verification passes;
- Remote execution remains unperformed until this PR is merged.

Remote inventory completion is separate and requires an exact merged-main run on the user's machine with local Lark credentials.
