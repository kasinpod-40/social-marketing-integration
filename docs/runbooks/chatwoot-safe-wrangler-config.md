# Runbook — Prepare Chatwoot Safe Wrangler Config

## Purpose

Prepare the exact all-flags-false local config required by the merged Chatwoot Remote readiness
Operator without committing the ignored developer-owned `wrangler.sync.jsonc` or any generated
output.

The generator runs locally only. It performs no Remote command and no mutation.

## Prerequisites

- Run from a clean, current `main` after this implementation is merged.
- Local `wrangler.sync.jsonc` must target the Integration Workspace.
- Cloudflare authentication is not required for config preparation.
- `outputs/` and `wrangler.sync.jsonc` remain ignored by Git.

## Prepare

Default source and output:

```text
source = wrangler.sync.jsonc
output = outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc
```

Command:

```bash
npm run prepare:chatwoot-readiness-config
```

Optional explicit paths:

```bash
npm run prepare:chatwoot-readiness-config -- \
  --source="$PWD/wrangler.sync.jsonc" \
  --output="$PWD/outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc"
```

The output JSON reports only hashes, counts, safe target names and the generated path. It does not
print the D1 UUID, Provider identity or Secret values.

## Generator validation

Preparation fails closed unless the source has exactly:

```text
Worker                      = social-mkt-sync-worker
MKT_ENV                     = development
MKT_CUSTOMER_PROFILE        = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY = chemistry_k
D1 binding                  = MKT_STATE_DB
D1 database                 = social-mkt-state-dev
Main Queue binding          = MKT_SYNC_QUEUE
Main Queue                  = social-mkt-sync-jobs
DLQ                         = social-mkt-sync-dlq
Main consumer               = concurrency 1 / batch 10 / timeout 30 / retries 5
DLQ consumer                = concurrency 1 / batch 10 / timeout 30 / retries 10
```

The generated file:

- sets every Chatwoot readiness execution flag explicitly to `false`;
- contains no triggers or routes;
- contains no Chatwoot URL/account, OAuth ID, Lark mapping or Secret value;
- preserves only the minimum local Worker/D1/Queue identity required by Wrangler read commands;
- is written below ignored `outputs/` with restricted file permissions;
- is validated by `validateChatwootRemoteWranglerConfig()` before success is reported.

## Local verification

```bash
node --test tests/application/chatwoot-safe-wrangler-config.test.js
npm run check

test -f outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc \
  && echo SAFE_CONFIG_READY

git status --short
```

The generated output is ignored, so `git status --short` must remain empty on clean `main`.

## Remote preflight handoff

Only after config preparation succeeds, run the already-authorized read-only phase using the generated
path:

```bash
SAFE_CONFIG="$PWD/outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc"

MKT_ENV=development \
MKT_CUSTOMER_PROFILE=integration_workspace \
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
MKT_CHATWOOT_ROLLOUT_DATABASE_NAME=social-mkt-state-dev \
MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG="$SAFE_CONFIG" \
CONFIRM_CHATWOOT_REMOTE_PREFLIGHT=READ_ONLY_CHATWOOT_REMOTE_PREFLIGHT \
npm run rollout:chatwoot-readiness:preflight
```

Stop immediately if either preparation or preflight fails. Do not create a backup, apply Migration
`0018`, run schema read-back, call Chatwoot, send Queue messages, mutate Lark, deploy the Worker or
activate Schedule/Webhook as a workaround.
