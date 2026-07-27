# Chatwoot Safe Wrangler Config Generator

## Status

```text
IMPLEMENTATION_IN_PROGRESS / DRAFT / REPOSITORY_ONLY
```

## Problem

The authorized Chatwoot Remote read-only preflight stopped before Operator invocation because no local
Wrangler config simultaneously satisfied the exact Integration Workspace target/topology and the
explicit all-execution-flags-false contract.

Observed safe stop:

```text
code                    = NO_MATCHING_SAFE_WRANGLER_CONFIG
operatorInvoked         = false
remoteMutationCount     = 0
```

## Objective

Generate a deterministic local Safe Wrangler config from the ignored developer-owned
`wrangler.sync.jsonc` without committing the source config, D1 UUID, Provider values, Customer
mappings or Secret values.

## Contract

The generator must:

- require Worker `social-mkt-sync-worker`;
- require `MKT_ENV=development`;
- require `MKT_CUSTOMER_PROFILE=integration_workspace`;
- require `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`;
- require D1 binding `MKT_STATE_DB` targeting `social-mkt-state-dev` with a valid immutable UUID;
- require producer binding `MKT_SYNC_QUEUE` targeting `social-mkt-sync-jobs`;
- require the reviewed Main Queue and DLQ consumer settings exactly;
- emit every flag in `CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS` as the string `false`;
- omit triggers, routes, Provider identity, OAuth values, Lark mappings and Secret-shaped values;
- write only below ignored `outputs/` with local file permissions;
- validate the generated text through `validateChatwootRemoteWranglerConfig()`;
- issue no Git, Wrangler, D1, Worker, Queue, Lark or Provider command.

## Files

```text
scripts/lib/chatwoot-safe-wrangler-config.js
scripts/prepare-chatwoot-safe-wrangler-config.mjs
tests/application/chatwoot-safe-wrangler-config.test.js
docs/runbooks/chatwoot-safe-wrangler-config.md
```

## Out of scope

```text
Remote read-only preflight execution
D1 backup or Migration 0018 apply
Schema read-back
Chatwoot Provider or Token access
Worker deployment
Queue/DLQ action
Lark mutation
Schedule/Webhook activation
Production
```

## Acceptance

- JSONC comments and trailing commas are supported without executing source text.
- Target or Queue/DLQ topology drift fails closed.
- Generated output passes the existing Chatwoot readiness config validator.
- Source true/omitted flags are converted to explicit false values.
- Generated config contains no Provider/Secret/Schedule/route value.
- Full repository verification remains required before merge.

## Current-task coexistence

`docs/current-task.md` belongs to the active Meta D1-only rollout workstream and is intentionally not
replaced by this parallel Chatwoot repository task. This task is recorded in this modular task file,
the Project Brain record and the Draft PR.
