# Current Task — Chatwoot Remote Read-only Preflight and Migration 0018 Readiness

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = CHATWOOT_REMOTE_PREFLIGHT_AND_MIGRATION_READINESS
BASE_MAIN_SHA                       = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                              = integration/chatwoot-remote-preflight
DRAFT_PR                            = NOT_OPEN
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
MIGRATION_0017                      = APPLIED_REMOTE / DO_NOT_RERUN
MIGRATION_0018                      = SOURCE_ONLY / NOT_APPLIED
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE
CHATWOOT_PROVIDER_REQUEST           = NOT_RUN
QUEUE_OR_DLQ_ACTION                 = NONE
LARK_MUTATION                       = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
PRODUCTION                          = BLOCKED
```

The preceding merge-closeout task is preserved at:

```text
docs/archive/current-task-before-chatwoot-remote-preflight-2026-07-27.md
```

## Objective

Implement a guarded, plan-only-by-default Integration operator that can later perform separately
confirmed Chatwoot Remote readiness phases without creating a new Reliability, Queue, D1 or Lark
framework. The operator must prove the exact Integration Workspace target, all-false execution state,
Migration `0018` ledger state, checksum-backed backup and additive schema read-back before any later
Chatwoot Provider or Business-data UAT is considered.

This Repository task implements and tests the operator only. It does not execute any Remote phase.

## In scope

- Add `scripts/chatwoot-remote-readiness-operator.mjs`.
- Add a focused library under `scripts/lib/` for arguments, confirmations, target/config validation,
  Migration ledger validation, read-only SQL and evidence validation.
- Add package scripts for `plan`, `preflight`, `backup`, `migrate` and `schema-readback`.
- Add focused Node tests and a Thai operator runbook.
- Reuse Wrangler/D1 execution conventions and existing Repository gates.
- Keep every Chatwoot, Queue/DLQ, Schedule, Webhook, Report and other Business execution flag false.
- Record sanitized evidence only; never persist Secret values, Provider payloads or customer PII.

## Operator phases

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

Every executable phase requires its own exact confirmation. No phase is implied by another phase.
The default invocation prints a plan and executes no Git, Wrangler, D1, Worker, Queue, Lark or
Chatwoot Provider command.

## Required target

```text
MKT_ENV                          = development
MKT_CUSTOMER_PROFILE             = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY      = chemistry_k
D1 database                      = social-mkt-state-dev
Worker                           = social-mkt-sync-worker
Required pending Migration       = 0018_chatwoot_analytics.sql only
Previous Migration               = 0017_woocommerce_commerce.sql already applied / do not rerun
```

## Safety contracts

- `preflight` is read-only and must fail unless all Business/Schedule/Webhook/DLQ-redrive flags are
  explicitly false, the exact D1 binding/Queue topology is present, active durable work and active
  locks are zero, Chatwoot tables are absent, and the only pending migration is `0018`.
- `backup` requires passed preflight evidence and produces a non-empty local SQL export plus SHA-256.
- `migrate` requires passed preflight and checksum-verified backup evidence; it may apply only the
  exact pending Migration `0018` and must fail on any additional or missing pending migration.
- `schema-readback` is read-only and requires no pending migrations, exactly 14 Chatwoot tables,
  exactly 15 reviewed Chatwoot indexes, zero Chatwoot Business rows and no drift in captured Shared
  operational/business counts.
- The operator contains no Chatwoot HTTP request, Token read, Queue send, DLQ action, Lark call,
  Worker deploy, Schedule/Webhook activation, retention/delete or Production path.
- Migration `0017` must never be rerun.

## Required false gates

At minimum the operator must reject configuration unless these Chatwoot controls are false:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

It must also verify the Shared Integration Workspace Business, Queue-redrive, reporting, retention
and other channel Schedule gates remain false so Migration readiness cannot activate unrelated work.

## Acceptance criteria

- Unsupported arguments/phases fail with stable sanitized codes.
- Every executable phase has a distinct exact confirmation.
- Target identity is locked to the Integration Workspace and exact D1 database.
- Config validation fails closed on any enabled Business/Schedule/Webhook/DLQ-redrive flag.
- Migration parser accepts only `0018_chatwoot_analytics.sql` as pending before apply and none after.
- Preflight and schema SQL are `SELECT`-only.
- Preflight rejects active work, active locks or any pre-existing Chatwoot schema.
- Post-migration validation requires 14 tables, 15 indexes, zero rows and Shared count parity.
- Backup evidence is non-empty and checksum-bound.
- Evidence excludes Secret values, raw config contents, raw Provider responses and PII.
- No Remote execution occurs during Implementation or CI.

## Required verification

```text
npm ci
npm run check
node --test tests/application/chatwoot-remote-readiness-operator.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Out of scope

```text
Remote preflight execution
Remote D1 export or backup
Migration 0018 apply
Remote schema read-back
Chatwoot base URL/account identity validation
Chatwoot Token read/rotation
Chatwoot Provider API request
Lark schema preview/apply/read-back
Queue message or DLQ action
Worker deployment
State-only or full-snapshot UAT
Schedule or Webhook activation
Production
Merge into main
```

## Implementation result

Pending. Record final SHAs, files changed, test counts, Migration/operator audit, exact verification
and confirmation that Remote actions remain zero before Integration Review.
