# Chatwoot Final UAT — Preflight Initialization Hotfix

## Status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BRANCH                              = hotfix/chatwoot-final-preflight-initialization
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

The guarded Chatwoot Final UAT reached the inner operator after local gates, Lark mapping and Queue REST discovery, then stopped with:

```text
CHATWOOT_FINAL_UAT_FAILED
Cannot access 'preflight' before initialization
safeRestore = NOT_REQUIRED
production = BLOCKED
```

No temporary Active Worker deployment, Queue send, D1/Lark Business write or Chatwoot Provider request occurred.

## Root cause

Inside `main()`, a block-scoped result variable used the same identifier as the `preflight()` function:

```js
const preflight = await preflight(target);
```

JavaScript places the local `const preflight` in the temporal dead zone for the whole initializer, so the function reference on the right-hand side resolves to the uninitialized local binding rather than the outer function declaration.

## Correction

- rename the local result to `preflightResult`;
- use the renamed result for read-only evidence and Safe-restore baseline ownership;
- retain the existing `preflight(target)` function and execution order;
- add a focused source regression forbidding function/result identifier shadowing;
- preserve the same public command and all existing safety gates.

## Safety contract

- no Remote action during Repository implementation or CI;
- preflight remains read-only;
- D1 backup still occurs only after successful preflight;
- Active deployment still occurs only after successful preflight and backup;
- `safeRestore` remains unset until the Active deployment succeeds;
- Schedule, Webhook and Production remain disabled/blocked.

## Required validation

```text
npm ci
npm run check
focused Chatwoot Final/Lark/Queue/runtime/recovery tests
focused TikTok regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

## Acceptance criteria

```text
preflight function callable without TDZ shadowing        PASS required
read-only preflight evidence uses renamed result         PASS required
Safe-restore baseline uses renamed result                PASS required
D1 backup / Active deployment ordering                   unchanged
public Terminal command                                  unchanged
Remote actions during implementation                     0
Schedule / Webhook / Production                          disabled / disabled / blocked
```
