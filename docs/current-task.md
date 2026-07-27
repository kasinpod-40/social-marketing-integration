# Current Task — YouTube Live Remote Contract Parser Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_PENDING_BRANCH_VERIFICATION
CURRENT_PROGRAM                     = YOUTUBE_LIVE_REMOTE_CONTRACT_PARSER_HOTFIX
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
BRANCH                              = hotfix/youtube-live-remote-contract-parser
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
REMOTE_ACTION_AUTHORIZED            = false
REMOTE_ACTIONS                      = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
REMOTE_D1                           = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
YOUTUBE_LARK_OAUTH_ANALYTICS        = NOT_RUN
SCHEDULE_ROUTE_SECRET_MUTATION      = NONE
PRODUCTION                          = BLOCKED
```

The preceding Chatwoot merge-closeout task is preserved verbatim at:

```text
docs/archive/current-task-before-youtube-live-remote-contract-parser-hotfix-2026-07-27.md
```

## Incident

The authorized YouTube Remote read-only preflight reached the live Cloudflare contract parser and
stopped fail-closed before any mutation:

```text
ACTIVE_VERSION                       = 55e7bed8-5abd-4ffa-b7eb-2d3fe1e195fb
ACTIVE_TRAFFIC                       = 100%
WRANGLER_VERSION                     = 4.110.0
WRANGLER_AUTH                        = AUTHENTICATED
REMOTE_MUTATION                      = NONE
DECISION                             = BLOCKED_REMOTE_CONTRACT
BLOCKER                              = remoteQueueName is required
```

The live `queues consumer list <queue> --json` response was already scoped by the exact Queue command
but omitted a Queue-name field inside its consumer item. The live Worker version response retained
the immutable D1 UUID but omitted the human-readable D1 database name.

## Objective

Add a fail-closed compatibility adapter for sanitized live Wrangler response shapes without weakening
the reviewed YouTube Remote contract validator or creating a second Runtime/Queue/Reliability layer.

## In scope

- Bind an omitted Queue name only from an explicit reviewed command context.
- Reject any explicit Queue name that differs from that command context.
- Keep Main Queue and DLQ command contexts separate.
- Treat the immutable D1 database UUID as required Remote identity.
- Permit an omitted D1 display name only after the exact UUID matches.
- Reject missing/mismatched D1 UUID and explicit D1-name drift.
- Delegate flags, bindings, Secret names, consumer settings, Cron, routes, workers.dev, traffic and
  Remote fingerprint validation to the existing reviewed validator.
- Add a plan-only local CLI for validating captured sanitized live response JSON through the adapter.
- Add focused regression tests and durable task/Project Brain records.

## Out of scope

```text
Worker deploy/version upload/rollback
Remote D1 query/write/migration
Queue send/Ack/Retry/DLQ action
YouTube/Lark/OAuth/Analytics request
Cron/route/workers.dev/Secret mutation
Production or Customer LIVE UAT
PR merge
```

## Compatibility contract

### Queue consumer responses

```text
identity source when response contains Queue name = response value, must match command context
identity source when response omits Queue name     = exact expectedQueueName command context
missing command context                            = fail closed
explicit mismatch                                  = fail closed
Main Queue and DLQ                                  = separate contexts
```

The adapter does not infer Queue identity from retry counts, array position or DLQ settings.

### D1 version binding

```text
binding name          = MKT_STATE_DB exactly once
immutable database ID = required valid UUID and exact reviewed match
database display name = optional in live response
missing display name  = restored only after UUID match
explicit name drift   = fail closed
missing/mismatched ID = fail closed
```

### Delegation boundary

The adapter normalizes only the two proven metadata omissions above and then calls
`validateRemoteYouTubeDeploymentContract`. It does not reimplement flag, trigger, consumer-setting,
Secret-name, traffic or fingerprint decisions.

## Files

```text
scripts/lib/youtube-live-remote-contract-parser.js
tests/application/youtube-live-remote-contract-parser.test.js
scripts/validate-youtube-live-remote-contract.mjs
package.json
docs/tasks/youtube-live-remote-contract-parser-hotfix.md
docs/project-brain/youtube-live-remote-contract-parser-hotfix-2026-07-27.md
```

## Required tests

- Missing Queue name plus exact command context passes.
- Explicit response-level or consumer-level Queue mismatch fails.
- Main Queue and DLQ contexts remain distinct.
- Missing D1 name plus exact UUID passes.
- Missing/mismatched D1 UUID fails.
- Explicit D1-name drift fails.
- Compatibility adapter produces the exact reviewed deterministic Remote fingerprint.
- Existing YouTube operator, Queue, Worker-runtime and all Connector regressions remain green.
- Repository architecture/hygiene, dependency audit and Wrangler dry-run pass.

## Implementation result

```text
ADAPTER_IMPLEMENTED                  = YES
PLAN_ONLY_VALIDATOR_CLI              = YES
FOCUSED_TESTS_ADDED                  = 6
REMOTE_RESPONSE_VALUES_COMMITTED     = NO
SECRET_VALUES_COMMITTED              = NO
REMOTE_ACTION_COUNT                  = 0
BRANCH_VERIFICATION                  = PENDING
FULL_TEST_RESULT                     = PENDING
DECISION                             = PENDING_CI_REVIEW
```

## Required next gate

Open a Draft PR and wait for Branch Verification on the exact final head. This task authorizes no
Remote preflight retry. After Repository review/merge, the user must separately authorize a new
read-only preflight attempt against then-current `main` and then-current active Worker version.
