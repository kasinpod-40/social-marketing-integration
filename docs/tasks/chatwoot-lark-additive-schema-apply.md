# Chatwoot Lark Additive Schema Apply

## Status

```text
TASK_STATUS                    = PASS_FOR_MERGE
SCOPE                          = REPOSITORY_OPERATOR_ONLY
CONTRACT_VERSION               = chatwoot-lark-additive-schema-apply-v1
BASE_MAIN                      = 4e31f811a8c9960d0bda714c0c7c0fe125d305aa
BRANCH                         = integration/chatwoot-lark-additive-schema-apply
DRAFT_PR                       = #172
IMPLEMENTATION_HEAD            = 21e5011ef6bb8149fc54d3c633cb688f62e36818
REMOTE_LARK_APPLY              = NOT_RUN_DURING_IMPLEMENTATION
PROVIDER_REQUEST               = NONE
D1_QUEUE_DEPLOY_SCHEDULE       = NONE
PRODUCTION                     = BLOCKED
```

`docs/current-task.md` remains owned by the active cross-workstream rollout and is intentionally not modified.

## Reviewed live input

The merged metadata-only operator ran from clean `main@8364375549f36f0d005aea20864b0bdb5c579adb` and returned:

```text
decision                       = CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED
remoteTableCount               = 56
expected Chatwoot tables       = 15
resolved Chatwoot tables       = 0
missing Chatwoot tables        = 15
create_table actions           = 15
blockers                       = 0
missing fields in bound tables = 0
destructive actions            = 0
Lark metadata requests         = 1
Lark mutations                 = 0
```

The exact evidence remains local and ignored at:

```text
outputs/chatwoot-lark-metadata-readiness/summary.json
```

## Objective

Add one guarded, replay-safe operator that can apply only the reviewed additive Chatwoot Lark schema:

```text
10 RAW tables
5 Canonical/Daily tables
15 total tables
```

The operator reuses:

- `CHATWOOT_LARK_BLUEPRINT` as Data Model authority;
- `discoverChatwootLarkTables` and `analyzeChatwootLarkMetadata` for before/after verification;
- the existing `LarkBitableClient.createTable` and `createField` methods;
- existing Lark credential and pagination/retry handling.

It does not create a second Lark client, sync engine, reliability framework or configuration writer.

## Safety contract

The default command is plan-only:

```bash
node scripts/chatwoot-lark-schema-apply.mjs
```

Remote Apply requires all of the following:

1. clean `main`;
2. `HEAD === origin/main`;
3. the reviewed metadata evidence file;
4. fresh metadata re-read immediately before mutation;
5. zero blockers and zero destructive actions;
6. exact confirmation:

```text
CONFIRM_CHATWOOT_LARK_SCHEMA=APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA
```

Only these actions are accepted:

```text
bind_table_env   local output only; no Lark mutation
create_table     additive Lark mutation
create_field     additive Lark mutation
```

The operator has no Table rename/delete, Field delete/type-change, record read/write, Provider, D1, Queue, Worker deployment, Schedule/Webhook or Production path.

## Transport-safe creation types

The Blueprint keeps preferred presentation types and compatible transport types. New tables are created with the type that matches the current PII-minimized Write set without adding a conversion layer:

```text
Stable key / hash / revision / date text = Text
Boolean state written as 0/1             = Number
Open-ended enum/status text              = Text
Epoch timestamps                         = Number
Counts and duration seconds              = Number
```

This remains valid under the merged metadata compatibility contract:

```text
Checkbox ↔ Number 0/1
SingleSelect ↔ Text
DateTime ↔ epoch Number
```

## Apply and verification sequence

```text
validate reviewed evidence
→ read current Tables/Fields
→ reject drift/blockers/destructive actions
→ create missing Tables/Fields sequentially
→ discover all 15 Tables again
→ read all Field metadata
→ require PASS_CHATWOOT_LARK_METADATA_READY
→ write sanitized summary
→ write local ignored Environment mapping fragment
```

Outputs:

```text
outputs/chatwoot-lark-schema-apply/summary.json
outputs/chatwoot-lark-schema-apply/environment-updates.env
```

The summary contains only counts and fingerprints. Raw Table IDs exist only in the local ignored Environment fragment and console-independent in-memory bindings.

The operator never edits `.dev.vars` or `wrangler.sync.jsonc` automatically.

## Partial failure and idempotency

Create operations use the existing Lark client's rate-limit-only retry policy. If a later action fails after one or more Tables were created, the command reports `partialMutationPossible=true`.

A rerun is safe:

- already-created Tables are discovered by exact alias;
- their action becomes `bind_table_env` rather than a duplicate create;
- only remaining reviewed Tables/Fields are created;
- an already-complete schema produces zero mutations.

## Command after merge

```bash
CONFIRM_CHATWOOT_LARK_SCHEMA=APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA \
  node scripts/chatwoot-lark-schema-apply.mjs --phase=apply --execute
```

This command performs a Remote Lark schema mutation and must be run only after the Repository implementation is merged and exact-head CI passes.

## Exact implementation verification

Implementation head `21e5011ef6bb8149fc54d3c633cb688f62e36818` passed Branch Verification #805 / run `30304575165` completely:

```text
INSTALL_LOCKED_DEPENDENCIES         = PASS
SYNTAX_ARCHITECTURE_HYGIENE         = PASS
FOCUSED_STAGED_TIKTOK               = PASS
NODE_AND_WORKERS_RUNTIME            = PASS
REPORT_RELIABILITY                  = PASS
DEPENDENCY_AUDIT                    = PASS
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                = 8667939296
DIAGNOSTICS_DIGEST                  = sha256:384008cb72f0d41bacca515ab590f5bc3d814e573e0cf20b7752b32068649cbe
REMOTE_ACTION_COUNT                 = 0
```

Alignment PR #171 merged current `main@4e31f811a8c9960d0bda714c0c7c0fe125d305aa` into the feature Branch. The final feature Diff remains five isolated Chatwoot Lark schema files.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-lark-metadata-readiness.test.js \
  tests/application/chatwoot-lark-schema-apply.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

## Remaining gates

1. Docs-final exact-head Branch Verification and zero-thread review.
2. Squash Merge Repository implementation.
3. Run the single confirmed Apply command from current clean `main`.
4. Copy the generated 15 mappings into local ignored configuration.
5. Rerun metadata-only preflight and require `PASS_CHATWOOT_LARK_METADATA_READY`.
6. Chatwoot Profile ID `14` must still be promoted from `agent` to `administrator` before Provider Reporting Events and Runtime activation can pass.
