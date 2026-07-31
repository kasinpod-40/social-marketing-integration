# Chatwoot Final 30-Day UAT + Daily Incremental Closeout

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
SCOPE                               = REPOSITORY_ONLY
BASE_MAIN                           = 95fe279d6ef46978d95acb1611ec859ae35cba64
BRANCH                              = integration/chatwoot-final-30d-daily-uat
REMOTE_PROVIDER_REQUEST             = 0
REMOTE_D1_QUERY_WRITE               = 0
REMOTE_LARK_REQUEST_MUTATION        = 0
QUEUE_MESSAGE                       = 0
WORKER_DEPLOYMENT                   = 0
SCHEDULE_WEBHOOK_ACTIVATION         = 0
PRODUCTION                          = BLOCKED
```

`docs/current-task.md` remains owned by the active WooCommerce Workstream and is intentionally unchanged.

## Objective

Provide one plan-only-by-default, exact-confirmation Terminal command that finishes the Integration Workspace Chatwoot runtime UAT from clean current `main`:

```text
read-only target and Lark preflight
→ fresh Remote D1 backup
→ temporary reviewed Chatwoot-active Worker deployment
→ exact rolling 30-day Initial operation
→ bounded durable completion and D1/Lark parity
→ same-operation idempotent replay
→ exact rolling three-day Daily Incremental operation
→ same-operation Daily replay
→ automatic all-flags-false Safe restore
→ immutable completion summary
```

The operator must reuse the merged Chatwoot runtime and Shared Core. It must not create another Connector, Reliability engine, Queue framework, D1 writer, Lark writer or Schedule producer.

## Locked runtime contract

```text
initial window                         exact rolling 30 days
incremental overlap                    exact rolling 3 days
window anchor                          Stable Queue originalRequestedAt
frequency contract                     daily
automatic history expansion            false
older-created updated Conversations    included
missing duration metric                null
one Queue delivery                     one bounded durable unit
Schedule                               disabled
Webhook                                disabled
Production                             blocked
```

## Active execution window

Exactly these four flags may be true during the temporary UAT deployment:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED
MKT_CHATWOOT_D1_WRITE_ENABLED
MKT_CHATWOOT_LARK_WRITE_ENABLED
MKT_CHATWOOT_REPORT_WRITE_ENABLED
```

Every other `MKT_*_ENABLED` flag remains false. In particular:

```text
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

The final state must be an independently verified all-flags-false Worker deployment.

## Admission and safety

Before the first Remote mutation, the one-command operator must prove:

- clean Repository and exact `HEAD == origin/main`;
- `development / integration_workspace / chemistry_k` target;
- no pending D1 Migration;
- exact reviewed D1 and Queue topology;
- one 100% active Worker version, no routes, workers.dev disabled and unchanged Cron set;
- required Worker Secret names and all 15 Chatwoot Lark table mappings present;
- Lark tables and Stable-key fields exist without schema mutation;
- no active Chatwoot Work, lock or Queue operation;
- no prior operation/evidence identity collision;
- both generated Safe and Active bundles pass Wrangler dry-run.

A fresh private D1 export with SHA-256 is required before deployment.

## Durable execution and recovery

The operator persists private SHA-chained evidence and attempt markers before every deployment or Queue send. A send attempt without a verified checkpoint is never repeated blindly. Existing operation state must be inspected first.

Initial and Daily jobs use Stable Queue identity created by the shared `createStableQueueOperationBody()` contract. Continuations are emitted only by the merged Worker runtime and preserve the exact operation identity.

Bounded polling records sanitized progress only:

- lifecycle and completion state;
- durable next sequence/stage while active;
- Queue attempt count;
- processed page and selected-row counters;
- Coverage counts and failed rows;
- D1/Lark table counts;
- cursor/checkpoint state.

No Provider payload, Message content, Contact PII, Token, raw Table ID or credential value may be persisted in evidence.

## Verification contract

Initial completion must prove:

- Work lifecycle `completed` and completion JSON present;
- exact 30-day immutable window and final checkpoint complete;
- multiple bounded unit deliveries occurred;
- zero active lock, terminal Chatwoot DLQ and Chatwoot critical alert;
- zero failed Coverage rows;
- D1 and Lark counts match for all 15 targets;
- no automatic backfill expansion;
- cursor points to the exact Initial operation.

Same-operation replay must increase Queue attempt evidence while preserving all Business, Coverage, cursor and Lark counts.

Daily Incremental must prove:

- exact three-day immutable window;
- cursor incremental count advances once;
- older-created updated Conversations remain admitted by the runtime contract;
- D1/Lark parity remains exact;
- same-operation Daily replay causes no Business, Coverage, cursor or Lark drift.

## Failure closeout

After the operator owns an Active deployment, every success or failure path attempts the reviewed Safe deployment. Restore is allowed only when the current active version is still one of the operator-owned versions; concurrent deployment drift fails closed rather than overwriting another Workstream.

The final success marker is:

```text
CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
```

It is valid only when all four operation checks pass and Remote execution flags are all false.

## Repository validation

```bash
npm ci
npm run check
node --test \
  tests/application/chatwoot-final-30d-daily-uat.test.js \
  tests/application/chatwoot-runtime-wiring.test.js \
  tests/application/chatwoot-runtime-30d-daily.test.js \
  tests/application/chatwoot-runtime-contract-examples.test.js \
  tests/application/chatwoot-durable-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Out of scope

- Schedule/Cron activation or creation;
- Webhook activation;
- Production/customer-owned infrastructure;
- Chatwoot mutation endpoints;
- schema creation or migration apply;
- deleting existing D1/Lark Business facts;
- changing `docs/current-task.md`;
- Live execution before this implementation is reviewed, merged and exact-head verified.
