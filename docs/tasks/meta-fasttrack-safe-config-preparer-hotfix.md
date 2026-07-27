# Meta Fast-track Safe Config Preparer Hotfix

## Status

```text
TASK_STATUS                     = IMPLEMENTED_PENDING_CI
BASE_MAIN_SHA                   = fb3f2a46b4c22bd293ad5395e7717add75bba690
BRANCH                          = hotfix/meta-fasttrack-safe-config-preparer
REMOTE_EXECUTION_AUTHORIZED     = false
REMOTE_ACTIONS                  = NONE
```

## Incident

The first Chemistry K parallel read-only attempt failed before any mutation:

```text
Lane A: META_LARK_TABLE_MAPPING_DRIFT for rawMetaOrganicAccounts
Lane B: generated Wrangler dry-run parse failure (unexpected closing brace)
D1 writes / Queue / deploy / Lark mutation / Provider requests = 0
```

The failures came from stale and text-patched local `wrangler.sync.jsonc`, not the Meta runtime.

## Objective

Add one local-only preparer that creates a valid generated Meta fast-track Wrangler config under
`outputs/` without editing the source config:

- parse JSONC through the existing shared parser;
- preserve Infrastructure and non-secret runtime values;
- reject secret-shaped values in Wrangler vars;
- force every known execution flag and every observed `MKT_*_ENABLED` value to string `false`;
- synchronize the 15 required Meta Lark Table IDs from `.dev.vars`;
- validate the existing Meta D1-only and Meta Lark flag-window contracts;
- rebase config-relative paths for the generated output;
- run local Wrangler deploy dry-run only;
- output fingerprints and Environment names, never Table IDs or credentials.

## Command

```bash
DEV_VARS_FILE=/absolute/path/to/.dev.vars \
node scripts/prepare-meta-fasttrack-safe-wrangler-config.mjs \
  --source=/absolute/path/to/canonical/wrangler.sync.jsonc
```

Default generated output:

```text
outputs/meta-fasttrack-config/wrangler.meta-fasttrack.safe.jsonc
```

## Out of scope

- Worker deployment;
- Remote D1 query/write, backup or migration;
- Queue/DLQ message;
- Meta Provider request;
- Lark metadata or record request;
- Schedule/Secret/Production change.
