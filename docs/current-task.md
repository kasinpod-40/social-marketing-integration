# Current Task — Chatwoot Remote Read-only Preflight and Migration 0018 Readiness

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION_REVIEW
CURRENT_PROGRAM                     = CHATWOOT_REMOTE_PREFLIGHT_AND_MIGRATION_READINESS
BASE_MAIN_SHA                       = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                              = integration/chatwoot-remote-preflight
DRAFT_PR                            = #111 / OPEN / DRAFT / UNMERGED
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
VERIFIED_IMPLEMENTATION_HEAD        = 97dccf6b428f3d45f3577fabee379a5c1691e5c0
BRANCH_VERIFICATION                 = #662 / 30276869292 / PASS
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

## Objective completed

Implemented and verified a guarded, plan-only-by-default Integration operator that can later execute
separately confirmed Chatwoot Remote readiness phases without creating another Reliability, Queue,
D1 or Lark framework.

This Repository task did not execute any Remote phase.

## Merged-ready Repository scope

```text
scripts/chatwoot-remote-readiness-operator.mjs
scripts/lib/chatwoot-remote-readiness-operator.js
tests/application/chatwoot-remote-readiness-operator.test.js
docs/runbooks/chatwoot-remote-readiness.md
docs/tasks/chatwoot-remote-readiness.md
docs/project-brain/chatwoot-remote-readiness-implementation-2026-07-27.md
package.json
```

The operator supports:

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

Every executable phase requires its own exact confirmation and chain-bound evidence. Default
invocation prints a plan and executes no Git, Wrangler, D1, Worker, Queue, Lark or Chatwoot command.

## Locked target and migration contract

```text
MKT_ENV                          = development
MKT_CUSTOMER_PROFILE             = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY      = chemistry_k
D1 database                      = social-mkt-state-dev
Worker                           = social-mkt-sync-worker
Required pending Migration       = 0018_chatwoot_analytics.sql only
Previous Migration               = 0017_woocommerce_commerce.sql applied / do not rerun
Reviewed Chatwoot tables         = 14
Reviewed Chatwoot indexes        = 15
```

## Safety contracts

- `preflight` is read-only and fails unless all Business/Schedule/Webhook/DLQ-redrive flags are
  explicitly false, exact D1/Queue/DLQ topology is present, active Work/Locks are zero, Chatwoot
  schema is absent, and only Migration `0018` is pending.
- `backup` requires passed preflight evidence and creates a non-empty local SQL export plus SHA-256.
- `migrate` requires exact target/source binding and checksum-verified backup evidence; it can apply
  only Migration `0018` and requires no pending migration afterward.
- `schema-readback` is read-only and requires 14 tables, 15 indexes, zero Chatwoot rows, zero active
  Work/Locks and no drift in captured Shared counts.
- Evidence stores sanitized target/config/source fingerprints, Secret-name count/fingerprint and
  operational counts only. It excludes Secret values, raw config, Provider payload and PII.
- Operator source contains no Chatwoot HTTP request, Token-read path, Queue/DLQ, Lark call, Worker
  deployment, Schedule/Webhook, retention/delete or Production path.

## Required false Chatwoot controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Shared channel Business, reporting, retention, notification, Audit and DLQ-redrive controls are also
validated false so readiness cannot activate unrelated work.

## Migration/operator audit

```text
EXPECTED_PENDING_MIGRATION          = 0018_chatwoot_analytics.sql
PREVIOUS_MIGRATION_RERUN_PATH       = NONE
EXACT_TABLE_COUNT                   = 14
EXACT_INDEX_COUNT                   = 15
DESTRUCTIVE_SQL_ALLOWED             = false
PRE_FLIGHT_SQL                      = SELECT_ONLY
SCHEMA_READBACK_SQL                 = SELECT_ONLY
BACKUP_REQUIRED                     = true
BACKUP_SHA256_REQUIRED              = true
PROVIDER_PATH                       = NONE
QUEUE_OR_DLQ_PATH                   = NONE
LARK_PATH                           = NONE
WORKER_DEPLOY_PATH                  = NONE
SCHEDULE_OR_WEBHOOK_PATH            = NONE
```

## Verification result

Head `97dccf6b428f3d45f3577fabee379a5c1691e5c0` passed Branch Verification `#662` / run
`30276869292`:

```text
Install locked dependencies         PASS
Syntax / architecture / hygiene     PASS
Focused staged TikTok               4 / 4 PASS
Node Unit / Integration             1061 / 1061 PASS
Workers runtime                     11 / 11 PASS
Report reliability                  91 / 91 PASS
New readiness operator tests        11 / 11 included in full suite
Dependency audit                    0 vulnerabilities
Wrangler deployment dry-run         PASS / NO DEPLOYMENT
Diagnostics upload                  PASS
Artifact                            8657185518
Artifact digest                     sha256:76926b5ac7e12de66de6ec16b2fc67174d0442d8506b899c603d6fdfea2b8a6e
```

The workflow does not expose the requested standalone focused command or literal `git diff --check`
as separate steps. The new test file ran within the full Node suite, while `npm run check` supplied
syntax/architecture/repository-hygiene validation. No unrun command is falsely claimed.

## Remote safe state

```text
REMOTE_PREFLIGHT                    = NOT_RUN
REMOTE_D1_EXPORT_OR_BACKUP          = NOT_RUN
MIGRATION_0018_APPLY                = NOT_RUN
REMOTE_SCHEMA_READBACK              = NOT_RUN
CHATWOOT_TOKEN_ACCESS               = NOT_RUN
CHATWOOT_PROVIDER_API               = NOT_RUN
REMOTE_LARK                         = NONE
QUEUE_OR_DLQ                        = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
STATE_OR_REPORT_UAT                 = NOT_RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
PRODUCTION                          = BLOCKED
```

## Remaining gate

PR #111 remains Draft and unmerged. Exact documentation-head verification and Integration Review are
required before merge. Even after merge, every Remote phase remains separately confirmed; Repository
verification does not authorize preflight, backup, Migration apply, schema read-back or any later
Provider/Lark/UAT phase.
