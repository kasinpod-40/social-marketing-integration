# Chatwoot Runtime All-Flags-False Wiring — 30-Day UAT + Daily Incremental

## Status

```text
TASK_STATUS                         = IMPLEMENTED_PENDING_EXACT_HEAD_VERIFICATION
SCOPE                               = REPOSITORY_ONLY
CONTRACT_VERSION                    = chatwoot_runtime_30d_daily_v1
BASE_MAIN                           = 05ddfd8f30bdb5ea01d6e604fba501b02413b934
BRANCH                              = codex/chatwoot-runtime-all-flags-false-wiring
DRAFT_PR                            = #310
SUPERSEDED_DRAFT_PR                 = #309 (closed, unmerged)
REMOTE_PROVIDER_REQUEST             = 0
REMOTE_D1_QUERY_WRITE_MIGRATION     = 0
REMOTE_LARK_READ_WRITE_SCHEMA       = 0
QUEUE_MESSAGE_DURING_IMPLEMENTATION = 0
WORKER_DEPLOYMENT                   = 0
SCHEDULE_WEBHOOK_ACTIVATION         = 0
PRODUCTION_CUSTOMER_LIVE_UAT        = 0
```

`docs/current-task.md` is intentionally unchanged because an active parallel Workstream owns that file.

## Verified input gates

The Repository implementation starts only after the externally operated readiness gates supplied for this task:

```text
Provider GET-only preflight          = PASS_CHATWOOT_PROVIDER_GET_ONLY
Profile ID                           = 14
Role                                 = administrator
Account ID                           = 1
Provider requests                    = 8 / 8 passed
Lark metadata preflight              = PASS_CHATWOOT_LARK_METADATA_READY
Resolved Chatwoot tables             = 15 / 15
Missing tables                       = 0
Additive actions                     = 0
```

The implementation does not rerun either preflight and does not rerun Lark Schema Apply.

## Source authority and reused Shared Core

The implementation reuses rather than replaces:

- Migration `0018_chatwoot_analytics.sql` and its 14 D1 Chatwoot tables;
- the existing Chatwoot GET-only API transport and PII-minimized normalizers;
- `D1ChatwootAnalyticsStore` Stable-key upserts;
- the existing 15-table Chatwoot Lark Blueprint and Table mappings;
- `TableSyncEngine` for Lark planning and idempotent execution;
- `D1ResumableWorkStore` for generation fencing, phases and completion replay;
- `D1IncrementalStateStore` for the final cursor checkpoint;
- `runReliableSync`, distributed lock renewal and shared retry classification;
- the existing main Queue, terminal failure persistence and DLQ flow.

No second Reliability engine, Queue framework, D1 writer or Lark sync engine is introduced.

## Locked runtime contract

```text
CHATWOOT_INITIAL_BACKFILL_DAYS               = 30
CHATWOOT_INCREMENTAL_OVERLAP_DAYS            = 3
CHATWOOT_SYNC_FREQUENCY                      = daily
CHATWOOT_AUTO_EXPAND_BACKFILL                = false
CHATWOOT_INCLUDE_UPDATED_OLDER_CONVERSATIONS = true
```

The contract is fail-closed in `readChatwootRuntimeConfig`. Any attempt to set 90-day backfill, enable automatic expansion, change frequency, disable old-conversation updates or change the three-day overlap is rejected before Provider construction.

All execution flags remain `false` in the Repository defaults:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED       = false
MKT_CHATWOOT_D1_WRITE_ENABLED        = false
MKT_CHATWOOT_LARK_WRITE_ENABLED      = false
MKT_CHATWOOT_REPORT_WRITE_ENABLED    = false
MKT_SCHEDULE_CHATWOOT_ENABLED        = false
MKT_CHATWOOT_WEBHOOK_ENABLED         = false
```

Both `.dev.vars.example` and `wrangler.sync.example.jsonc` publish the exact contract above and no longer expose the retired 48-hour overlap input.

## Durable unit model

One Queue delivery processes at most one bounded durable unit and then either completes or emits one continuation with the exact same Stable Queue identity.

```text
masters
→ conversation pages
→ account reporting-event pages
→ bounded daily rollup pages (when report writes are enabled)
→ one final incremental checkpoint
→ durable completion replay
```

Durable phase state contains only:

- immutable mode/window;
- page cursors and total-page declarations;
- non-sensitive counters;
- compact numeric rollup accumulators;
- completion/checkpoint state.

Raw Provider payloads, Message content, Contact PII, names, email, phone, tokens and Lark Table IDs are not persisted in phase state.

## Window and dataset rules

- Accounts, Inboxes, Agents, Teams and Labels are refreshed as latest state.
- Initial Conversations, Messages and Reporting Events are bounded to the exact rolling 30-day interval anchored to stable `originalRequestedAt`.
- Daily incremental rereads the exact rolling three-day interval.
- Conversation selection considers `updated_at`, `last_activity_at` and `created_at`; therefore a Conversation created before the window remains included when activity/update intersects the window.
- Reporting Event selection considers event, create and update timestamps independently so late corrections in the overlap are included.
- A Reporting-only page writes only Reporting Events and their Coverage lineage; its synthetic normalization Account never rewrites latest-state Account data.
- Missing duration metrics remain `null`; the rollup never converts missing values to zero.
- Account Reporting pagination has a separate durable upper bound of 5,000 pages, safely above the verified 1,125-page inventory.
- Message and Conversation pagination remain bounded by the existing Provider and per-conversation limits.

## Partial failure, retry, DLQ and idempotency

A durable phase advances only after the current bounded unit completes its D1/Lark/coverage writes. A retry before phase advance reruns the same unit through existing Stable-key upserts. A duplicate or late continuation below `nextSequence` returns a stale-continuation result without Provider or Business writes.

The final incremental checkpoint is committed only after Conversation, Reporting and optional Rollup stages finish. `completeWork` is called only after that checkpoint. The Shared Queue router now recognizes Chatwoot for existing terminal-work abandonment and platform classification; it still persists terminal failures through the existing DLQ/System Alert path without adding a Chatwoot-specific framework.

## Plan-only operator

```bash
node scripts/chatwoot-runtime-plan.mjs \
  --mode=initial \
  --requested-at=2026-07-31T01:00:00Z \
  --conversation-pages=304 \
  --reporting-pages=1125 \
  --rollup-pages=31 \
  --conversation-pages-per-invocation=1 \
  --reporting-pages-per-invocation=5
```

The example resolves to `562` bounded units: one Masters unit, `304` Conversation units, `225` Reporting units, `31` supplied Rollup-page units and one Checkpoint/finalization unit. The operator imports only the pure Runtime contract and performs zero Provider requests, Queue sends, D1 reads/writes, Lark reads/writes, deployment, Schedule/Webhook action or Secret access.

## Controlled UAT left for Terminal

After merge and exact-head verification, a separate controlled Terminal step must:

1. use clean current `main`;
2. set only the reviewed temporary UAT flags and existing local ignored mappings/secrets;
3. create one stable Initial 30-day Queue operation;
4. observe durable completion, reconciliation and checkpoint;
5. run the idempotent rerun and partial-recovery checks;
6. restore all flags to false;
7. authorize daily Schedule only in a separate reviewed activation task.

No such Terminal, Queue, Remote D1/Lark, deployment or live UAT action is performed by this Workstream.

## Required exact-head verification

```bash
npm ci
npm run check
node --test \
  tests/application/chatwoot-runtime-wiring.test.js \
  tests/application/chatwoot-runtime-30d-daily.test.js \
  tests/application/chatwoot-runtime-contract-examples.test.js \
  tests/application/chatwoot-durable-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

GitHub Actions runs on both the original and active branches have failed at workflow startup before Checkout, with no job steps and no logs. This is recorded as `BLOCKED_BY_GITHUB_ACTIONS_STARTUP`, not as code PASS or code failure. Draft PR #310 must remain open and unmerged until a final exact head executes every gate successfully and review threads are resolved.
