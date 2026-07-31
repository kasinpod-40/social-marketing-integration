# Chatwoot Final UAT — Queue REST Discovery Hotfix

## Status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BASE_MAIN                           = d3592b256d52bf72e4a3d9d33ab707cb5bca4961
BRANCH                              = hotfix/chatwoot-final-queue-rest-discovery
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

The post-merge Chatwoot Final UAT rerun completed local gates and stopped with:

```text
CHATWOOT_FINAL_UAT_COMMAND_FAILED
npx wrangler queues list --json
safeRestore = NOT_REQUIRED
production = BLOCKED
```

The repository pins Wrangler `4.110.0`; its top-level `queues list` command has no JSON-output flag.
The failure occurred before temporary Active deployment, Queue submission, D1/Lark Business writes or
Chatwoot Provider access.

## Objective

Preserve the same public command while resolving the exact main Queue through the already-reviewed
Cloudflare REST discovery used by the WooCommerce Final operator:

```text
private normalized config
→ reviewed account/auth resolution
→ bounded GET /accounts/{account_id}/queues
→ exactly one social-mkt-sync-jobs identity
→ private child environment injection
→ existing lock and Final UAT sequence
```

## Reused authority

- `bootstrapWooCommerceFinalQueueId()` for pinned Wrangler account/auth bootstrap;
- `discoverWooCommerceQueueId()` for bounded Cloudflare Queue REST inventory;
- `resolveWooCommerceQueueId()` for exact-name and duplicate rejection;
- existing Chatwoot public Launcher and inner Final UAT operator.

No new Queue parser, Cloudflare authentication layer or message sender is introduced.

## Safety contract

- plan mode performs zero Remote request;
- execute mode uses one GET-only Queue inventory before mutation gates;
- exact Queue name is `social-mkt-sync-jobs`;
- local Chatwoot and WooCommerce final Queue-ID overrides are rejected/removed;
- raw Queue ID and bearer token never appear in output or public evidence;
- redirects, timeout, invalid JSON, failed API contract, pagination, missing or duplicate Queue fail closed;
- Queue discovery runs before exact lock admission and before the inner operator can deploy or send;
- Schedule, Webhook and Production remain disabled.

## Authoritative command after merge

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

No Queue ID or additional user input is required.

## Required validation

```text
npm ci
npm run check
Focused Chatwoot Final/Lark/Queue/runtime/recovery tests
Focused TikTok regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

## Acceptance criteria

```text
unsupported queues list --json path                 absent from public Launcher
exact main Queue discovered by reviewed REST core   PASS required
explicit Queue-ID bypass                            blocked
missing / duplicate / invalid Queue inventory       fail closed
raw Queue ID in output/evidence                     0
plan-mode Remote actions                            0
existing Final UAT safety sequence                  unchanged
Schedule / Webhook / Production                     disabled / disabled / blocked
```
