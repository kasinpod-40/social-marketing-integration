# Chatwoot Final UAT — Lark Table Auto-Mapping Hotfix

## Status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BASE_MAIN                           = f2c66d9c448357fb7f8266d5aa0fa9c91711929f
BRANCH                              = hotfix/chatwoot-final-lark-auto-mapping
REMOTE_PROVIDER_REQUEST             = 0
REMOTE_D1_QUERY_WRITE               = 0
REMOTE_LARK_REQUEST_MUTATION        = 0
QUEUE_MESSAGE                       = 0
WORKER_DEPLOYMENT                   = 0
SCHEDULE_WEBHOOK_ACTIVATION         = 0
PRODUCTION                          = BLOCKED
```

`docs/current-task.md` remains owned by the WooCommerce Workstream and is intentionally unchanged.

## Incident

The first post-merge Chatwoot Final UAT command stopped with:

```text
CHATWOOT_FINAL_UAT_INPUT_REQUIRED
LARK_TABLE_RAW_CHATWOOT_ACCOUNTS is required
safeRestore = NOT_REQUIRED
production = BLOCKED
```

The Launcher correctly stopped before the Inner operator reached Remote admission. No Provider request,
D1 query/write, Lark record request/mutation, Queue send or Worker deployment occurred.

Root cause: the 15 Chatwoot tables already exist in the Integration Workspace Lark Base, but the ignored
local `wrangler.sync.jsonc` did not contain their Table IDs. The merged Launcher normalized Runtime flags
and bounds but still required every Chatwoot Table ID to be copied manually into local config.

## Objective

Keep the same one-command handoff while removing manual Table-ID entry:

```text
read-only listTables
→ exact Blueprint alias discovery for 15 tables
→ fail closed on missing / ambiguous / identity mismatch
→ write IDs only to private ignored generated config
→ delegate unchanged guarded Final UAT Launcher
→ delete generated config after closeout
```

## Reused authority

- `CHATWOOT_LARK_BLUEPRINT` for exact names and aliases;
- `loadChatwootLarkMetadataTarget()` for exact Integration Workspace target;
- `discoverChatwootLarkTables()` for configured-ID, alias and stale-mapping behavior;
- existing `LarkBitableClient.listTables()` read-only transport;
- existing Final UAT Launcher, inner operator, D1/Lark parity and Safe restore.

No duplicate Lark discovery engine or schema operator is introduced.

## Safety contract

- plan mode performs zero Lark or other Remote request;
- execute mode performs one bounded read-only Lark table inventory before D1/Queue/Deploy work;
- raw Table IDs are never printed or written to public evidence;
- error details contain only logical table keys and counts;
- `.dev.vars` and `wrangler.sync.jsonc` are never modified;
- stale local IDs are repaired only inside the temporary generated config;
- exactly 15 unique tables are required;
- missing, ambiguous or wrong-identity tables block execution;
- Schedule, Webhook and Production remain disabled.

## Authoritative command after merge

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

No new user input or Table-ID preparation is required.

## Required validation

```text
npm ci
npm run check
Focused Chatwoot Final/Lark/runtime/recovery tests
Focused TikTok regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

## Acceptance criteria

```text
15 exact Lark mappings resolved automatically       PASS required
Stale local mappings repaired in temp config only   PASS required
Missing / ambiguous / wrong identity                fail closed
Raw Table IDs in output/evidence                    0
Plan-mode Remote actions                            0
Ignored local files edited                          0
Existing Final UAT safety sequence                  unchanged
Schedule / Webhook / Production                     disabled / disabled / blocked
```
