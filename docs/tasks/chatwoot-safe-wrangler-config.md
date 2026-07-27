# Chatwoot Safe Wrangler Config Generator

## Status

```text
PASS_FOR_INTEGRATION_REVIEW / DRAFT / REPOSITORY_ONLY / REMOTE_NOT_RUN
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

## Objective completed

Implemented a deterministic local Safe Wrangler config generator from the ignored developer-owned
`wrangler.sync.jsonc` without committing the source config, D1 UUID, Provider values, Customer
mappings or Secret values.

## Contract

The generator:

- requires Worker `social-mkt-sync-worker`;
- requires `MKT_ENV=development`;
- requires `MKT_CUSTOMER_PROFILE=integration_workspace`;
- requires `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`;
- requires D1 binding `MKT_STATE_DB` targeting `social-mkt-state-dev` with a valid immutable UUID;
- requires producer binding `MKT_SYNC_QUEUE` targeting `social-mkt-sync-jobs`;
- requires the reviewed Main Queue and DLQ consumer settings exactly;
- emits every flag in `CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS` as the string `false`;
- omits triggers, routes, Provider identity, OAuth values, Lark mappings and Secret-shaped values;
- writes only below ignored `outputs/` with local file permissions;
- rebases `$schema`, `main` and `migrations_dir` relative to the generated config location;
- validates the generated text through `validateChatwootRemoteWranglerConfig()`;
- issues no Git, Wrangler, D1, Worker, Queue, Lark or Provider command.

## Files

```text
scripts/lib/chatwoot-safe-wrangler-config.js
scripts/lib/rebase-generated-wrangler-config-paths.js
scripts/prepare-chatwoot-safe-wrangler-config.mjs
tests/application/chatwoot-safe-wrangler-config.test.js
docs/runbooks/chatwoot-safe-wrangler-config.md
docs/project-brain/chatwoot-safe-wrangler-config-2026-07-27.md
package.json
```

## Verification

Code head `909901f8e1696689c7412449d3a608dfe6df5e8d` passed Branch Verification `#701` / run
`30288947642`:

```text
Syntax / architecture / hygiene     PASS
Focused staged TikTok               4 / 4 PASS
Chatwoot safe-config regressions    5 / 5 PASS
Node Unit / Integration             1086 / 1086 PASS
Workers runtime                     11 / 11 PASS
Report reliability                  91 / 91 PASS
Dependency audit                    0 vulnerabilities
Wrangler deployment dry-run         PASS / NO DEPLOYMENT
Artifact                            8662007837
Artifact digest                     sha256:177f249e2ed0861fe18b8b0682179d837b34720a0bfd011cc1e7cee298abfc3f
```

The workflow runs the five focused generator regressions inside the full Node suite rather than as a
separate workflow step. No standalone command is falsely claimed.

## Out of scope and Remote safe state

```text
Remote read-only preflight execution = NOT RUN
D1 backup                             = NOT RUN
Migration 0018 apply                  = NOT RUN
Schema read-back                      = NOT RUN
Chatwoot Provider or Token access     = NOT RUN
Worker deployment                     = NOT RUN
Queue/DLQ action                      = NONE
Lark mutation                         = NONE
Schedule/Webhook activation           = NONE
Production                            = BLOCKED
```

## Current-task coexistence

`docs/current-task.md` belongs to the merged Meta D1-only rollout closeout and is intentionally not
replaced by this parallel Chatwoot repository task. This task is recorded in this modular task file,
the Project Brain record and Draft PR `#125`.

## Remaining gate

The Draft PR requires exact final documentation-head verification and a separate merge decision. After
merge, a clean current `main` may generate the ignored Safe config and run only the already-authorized
Remote read-only preflight. Backup and every later phase remain separately gated.
