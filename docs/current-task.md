# Current Task — Meta History 2026 One-Command Finalizer

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
CURRENT_PROGRAM                     = META_HISTORY_2026_FINALIZER_V1
BASE_MAIN_SHA                       = a1b04a02627db22a47ba1e83e9e445a6a2043258
WOOCOMMERCE                         = WOOCOMMERCE_2026_COMPLETED_SAFE
FACEBOOK_EXISTING_DELIVERY          = VERIFY_AND_REUSE_NO_PROVIDER_REPLAY
INSTAGRAM_HISTORY                   = 2026-07-01..2026-07-31
META_ADS_BASELINE                   = 2026-05-01..2026-07-31
META_ADS_YEAR_START_EXPANSION       = 2026-01-01..2026-04-30 / BOUNDED_VOLUME_ONLY
PINNED_META_HEAD                    = e069380a544575ce0fc9bca53f1fb56944d26c09
PINNED_INSTAGRAM_OPERATION          = meta-instagram-d1-20260729t065939687z-1ad3c9
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_EXECUTION_FLAGS              = ALL_FALSE
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Objective

Deliver a single reviewed Terminal command that resumes the exact pinned Meta session, preserves the
already-completed Facebook D1/Lark lane, loads one exact month of Instagram history, loads at least three
months of both Meta Ads accounts and expands Ads to January 1 only when the baseline remains inside
bounded volume limits.

The implementation must reuse the merged Meta Graph client, active router, Shared Queue/Reliability,
D1 stores, Coverage, Organic History Writer and TableSyncEngine. No replacement Connector, Queue,
Reliability engine, D1 writer or Lark engine is permitted.

## Locked history contract

```text
Facebook Organic
  existing completed pinned lane
  verify session/Lark closeout
  Provider replay = 0

Instagram Organic
  inclusive range 2026-07-01 through 2026-07-31
  newest-first cursor filtering
  stop only after lower range boundary is crossed

Meta Ads chemistry_k2 / chemistry_k3
  required range 2026-05-01 through 2026-07-31
  each Provider request <=31 inclusive days
  conditional range 2026-01-01 through 2026-04-30
```

Year-start expansion requires the combined required Ads operations to remain within:

```text
Ads Daily rows       <= 15,000
Ads Entity rows      <=  5,000
Coverage Entity rows <= 20,000
invalid Coverage      = 0
active Lock           = 0
Sync status           = success
```

## One-command contract

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-finalizer.mjs --execute
```

The command must perform all reachable validation before Remote mutation, persist deterministic operation
identity/generation, resume the pinned finalizer first, refresh GET-only identity proof, execute D1 before
same-operation Lark continuation, prove idempotent replays, restore every Worker flag false and finish with:

```text
META_HISTORY_2026_COMPLETED_SAFE
Active Work / Lock / Queue op = 0 / 0 / 0
Schedule                     = disabled
Production                   = blocked
```

## Implementation result

Implemented on branch `hotfix/meta-history-2026-one-command-v1`:

- Instagram inventory exact-range filtering with monotonic timestamp and cursor guards;
- Meta Ads multi-month durable compound cursor while retaining <=31-day Provider calls;
- Meta Lark Wrangler compatibility launcher using the existing normalization shim;
- exact persisted one-command plan and checkpoint-aware phase reuse;
- pinned Meta finalizer resume before supplemental operations;
- fresh four-target GET-only identity validation;
- required Instagram and Ads D1/Lark operations;
- adaptive year-start Ads expansion;
- all-false emergency restore and no-blind-resend boundary;
- focused source/finalizer/rollout regressions;
- exact branch CI routed to the repository-scoped runner.

Repository implementation and CI perform no Provider request, Remote D1/Lark mutation, Queue message,
Worker deployment, Schedule/Secret change or Production action.

## Acceptance criteria

```text
Exact clean merged main                    required
Full Repository gate                       pass
Facebook existing lane/session             verified / no Provider replay
Instagram July inventory                   complete
Meta Ads May-July both accounts            complete
Ads Jan-Apr                                complete only when volume gate permits
D1 before Lark                             required
D1/Lark parity                             pass
Same-operation rerun                       pass
Exact accepted Queue attempts              evidence-bound
Blind Queue resend                         forbidden
Worker execution flags                     all false
Active Work / Lock / Queue operation       0 / 0 / 0
Schedule / Production                      disabled / blocked
Decision                                   META_HISTORY_2026_COMPLETED_SAFE
```

## Required review and verification

```text
npm ci
npm run check
node --test tests/connectors/meta-history-range-adapters.test.js
node --test tests/application/meta-history-2026-finalizer.test.js
focused Meta D1/Lark operator regressions
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
unresolved review threads = 0
```

Detailed contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
