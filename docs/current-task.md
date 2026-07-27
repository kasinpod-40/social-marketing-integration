# Current Task — Chatwoot Safe Config and Remote Read-only Preflight

## Authoritative status

```text
TASK_STATUS                         = READY_FOR_LOCAL_PREPARATION_AND_REMOTE_READ_ONLY_PREFLIGHT
CURRENT_PROGRAM                     = CHATWOOT_REMOTE_READINESS_EXECUTION
BASE_MAIN_SHA                       = c124e6fdbe27fcd56fb357baef1b4769957748df
IMPLEMENTATION_OWNER                = CHATGPT_WORK_AND_CODEX_TERMINAL
CHATWOOT_READINESS_OPERATOR_PR      = #111 / MERGED
CHATWOOT_SAFE_CONFIG_PR             = #125 / MERGED
CHATWOOT_SAFE_CONFIG_MERGE_SHA      = e4ada6d91037a133aa6bfee17485e11ff3c4b49f
WOO_PRELIGHT_PR                     = #118 / MERGED
TIKTOK_AUDIT_FIX_PR                 = #120 / MERGED
SAFE_CONFIG_PREPARATION             = NOT_RUN
CHATWOOT_REMOTE_PREFLIGHT           = NOT_RUN
REMOTE_EXECUTION_AUTHORIZED         = CHATWOOT_READ_ONLY_PREFLIGHT_ONLY
REMOTE_D1_MUTATION                  = NONE
D1_BACKUP                           = NOT_RUN
MIGRATION_0018                      = SOURCE_ONLY / NOT_APPLIED
SCHEMA_READBACK                     = NOT_RUN
CHATWOOT_PROVIDER_REQUEST           = NOT_RUN
QUEUE_OR_DLQ_ACTION                 = NONE
LARK_MUTATION                       = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
PRODUCTION                          = BLOCKED
```

The preceding WooCommerce preflight task is archived by immutable commit/blob provenance at:

```text
docs/archive/woocommerce-customer-data-lark-preflight-merged-current-task-2026-07-28.md
```

## Objective

Prepare the exact local all-flags-false Wrangler config from the ignored Integration Workspace config,
then execute only the merged Chatwoot Remote read-only preflight and capture sanitized evidence.

```text
clean current main
→ local Safe config generation
→ local config validation
→ Remote read-only preflight
→ stop before Backup
```

## Repository and local file contract

- `wrangler.sync.jsonc` is local/ignored and must not be committed.
- Generated output is local/ignored at
  `outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc`.
- The generator must use the merged `chatwoot_safe_wrangler_config_v1` contract.
- It must require the exact Integration Workspace, Chemistry K, Worker, D1 and Queue/DLQ topology.
- Every required execution flag must be explicitly `false`.
- Generated config must omit triggers, routes, Provider identity, OAuth IDs, Lark mappings and Secret values.
- `$schema`, `main` and `migrations_dir` must be rebased for the generated config location.
- Generation performs no Git, Wrangler Remote, D1, Queue, Lark or Provider command.

## Exact target

```text
MKT_ENV                         = development
MKT_CUSTOMER_PROFILE            = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY     = chemistry_k
Worker                          = social-mkt-sync-worker
D1                              = social-mkt-state-dev
D1 binding                      = MKT_STATE_DB
Main Queue                      = social-mkt-sync-jobs
Main Queue binding              = MKT_SYNC_QUEUE
DLQ                             = social-mkt-sync-dlq
```

## Local preparation

Run from a clean, current `main`:

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD

npm run prepare:chatwoot-readiness-config

node --test tests/application/chatwoot-safe-wrangler-config.test.js
npm run check

test -f outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc \
  && echo SAFE_CONFIG_READY

git status --short
```

Preparation must stop if the target/topology differs, any required identity is missing, or the generated
file fails the existing Chatwoot readiness validator. Generated output must remain ignored so a clean
`main` stays clean.

## Remote read-only preflight

Only after local preparation succeeds:

```bash
npx wrangler whoami

SAFE_CONFIG="$PWD/outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc"

MKT_ENV=development \
MKT_CUSTOMER_PROFILE=integration_workspace \
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
MKT_CHATWOOT_ROLLOUT_DATABASE_NAME=social-mkt-state-dev \
MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG="$SAFE_CONFIG" \
CONFIRM_CHATWOOT_REMOTE_PREFLIGHT=READ_ONLY_CHATWOOT_REMOTE_PREFLIGHT \
npm run rollout:chatwoot-readiness:preflight
```

## Preflight evidence required

Return sanitized evidence for:

```text
current main SHA
Wrangler version / authenticated status without account or token disclosure
generated config path and SHA-256
Operator exit code and full sanitized JSON result
Evidence file path and digest
Worker / D1 / Queue / DLQ identity verdicts
Secret-name presence only; never Secret values
pending migration set
Migration 0017 state
Migration 0018 state
active durable-work count
active lock count
Chatwoot table/index counts
Remote mutation count
```

## Stop boundary

This task authorizes no later phase. Stop immediately after preflight success or failure.

```text
D1 backup                    NOT AUTHORIZED BY THIS TASK
Migration 0018 apply         NOT AUTHORIZED
Schema read-back             NOT AUTHORIZED UNTIL PRIOR PHASES PASS
Chatwoot Provider API        NOT AUTHORIZED
Queue / DLQ                  NONE
Lark                         NONE
Worker deployment            NOT AUTHORIZED
Schedule / Webhook           DISABLED
Production                   BLOCKED
```

Do not work around a failed gate by committing a local config, editing Remote configuration, applying a
migration, sending Queue messages, calling Chatwoot, mutating Lark or deploying the Worker.

## Definition of done for this gate

- Repository/local target is refreshed from current clean `main`.
- Safe config generation succeeds and output remains ignored.
- Focused generator tests and `npm run check` pass locally.
- Remote read-only preflight returns a target-bound sanitized evidence package.
- Remote mutation count remains zero.
- The result clearly identifies the next separately gated decision: blocker remediation, D1 Backup, or no-op.
