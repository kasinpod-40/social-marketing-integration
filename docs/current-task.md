# Current Task — Chatwoot Remote Read-only Preflight

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION_REVIEW
CURRENT_PROGRAM                     = CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
BASE_MAIN                           = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                              = integration/chatwoot-remote-read-only-preflight
DRAFT_PR                            = #109 / OPEN / DRAFT / UNMERGED
CHATWOOT_RUNTIME_PR                 = #97 / MERGED
CHATWOOT_RUNTIME_MERGE_COMMIT       = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
CHATWOOT_CLOSEOUT_PR                = #108 / MERGED
CHATWOOT_CLOSEOUT_MERGE_COMMIT      = f3e330339b114536c3a1a9ee7567abf5a76fa78b
MIGRATION_0017                      = APPLIED / DO_NOT_RERUN
MIGRATION_0018                      = SOURCE_ONLY / EXPECTED_PENDING
CODE_VERIFIED_HEAD                  = fce0028d0931eae79634d61bfc29ed4d14df8090
BRANCH_VERIFICATION                 = #657 / 30275990578 / PASS
FINAL_DOCUMENTATION_VERIFICATION    = RECORDED_IN_PR_109_METADATA
REMOTE_PREFLIGHT_EXECUTION          = NOT_RUN
REMOTE_MUTATION_AUTHORIZED          = false
PRODUCTION                          = BLOCKED
```

The previous Chatwoot Runtime Wiring Merge Closeout is preserved at:

```text
docs/archive/current-task-before-chatwoot-remote-read-only-preflight-2026-07-27.md
```

## Objective completed

A guarded Operator now performs the Repository-defined Remote Integration Workspace preflight before
any backup or application of `0018_chatwoot_analytics.sql`. The Operator is plan-only by default and
has one separately confirmed, read-only `preflight` phase.

Complete contract and durable project record:

```text
docs/tasks/chatwoot-remote-read-only-preflight.md
docs/project-brain/chatwoot-remote-read-only-preflight-2026-07-27.md
```

## Implemented repository scope

- exact `development` / `integration_workspace` / `chemistry_k` target lock;
- exact reviewed Git HEAD and clean Working Tree gate;
- exact active Worker version at 100% traffic;
- local Wrangler `deploy --dry-run --strict` bundle hash without deployment;
- Remote active-version plain-text flag inspection;
- Chatwoot Base URL and external Account ID verification through approved SHA-256 fingerprints only;
- Secret-name-only inspection requiring `CHATWOOT_API_ACCESS_TOKEN`;
- Remote D1 pending-migration list and applied-ledger `SELECT`;
- exact ledger contract: `0017` applied and `0018` the only pending migration;
- Main Queue and DLQ consumer metadata checks;
- Worker script, exact Cron and workers.dev checks;
- private sanitized Evidence under ignored `outputs/`;
- explicit zero Remote mutations, Provider requests and Secret-value reads.

## Locked target

```text
MKT_ENV                         = development
MKT_CUSTOMER_PROFILE            = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY     = chemistry_k
accountKey                      = chemistry_k
Worker                          = social-mkt-sync-worker
D1                              = social-mkt-state-dev / MKT_STATE_DB
Main Queue                      = social-mkt-sync-jobs
DLQ                             = social-mkt-sync-dlq
```

Base URL and external Account ID are never written to Evidence; only their approved SHA-256
fingerprints are retained.

## Required all-false flags

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Missing, malformed or non-false values fail closed.

## Migration and Secret contract

```text
0017_woocommerce_commerce.sql = applied / do not rerun
0018_chatwoot_analytics.sql   = absent from applied ledger
0018_chatwoot_analytics.sql   = only pending migration
unexpected pending migration  = none
required Secret name          = CHATWOOT_API_ACCESS_TOKEN
Secret-value reads             = forbidden
```

## Operator phases

```text
plan       = local plan only / default
preflight  = read-only Remote inspection after exact confirmation
```

Exact confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT=PREFLIGHT_CHATWOOT_REMOTE_READ_ONLY
```

## Verification result

Code head `fce0028d0931eae79634d61bfc29ed4d14df8090` passed Branch Verification
`#657` / run `30275990578`.

```text
Install locked dependencies         PASS
Syntax / architecture / hygiene     PASS
Focused staged TikTok               4 / 4 PASS
Chatwoot preflight focused tests    9 / 9 PASS
Node Unit / Integration             1059 / 1059 PASS
Workers runtime                     11 / 11 PASS
Report reliability                  91 / 91 PASS
Dependency audit                    0 vulnerabilities
Wrangler deployment dry-run         PASS / no deployment
Diagnostics upload                  PASS
Artifact                            8656831975
Artifact digest                     sha256:bc8c085862f25f29f4df76d6ca167b2fe86cb0158978bdea8014a644f795b44d
```

## Prohibited actions and actual safe state

```text
Chatwoot Provider/API request       NOT_RUN
Customer Token value read/rotation NOT_RUN
Remote D1 backup                   NOT_RUN
Migration 0018 apply               NOT_RUN
Remote D1 Business mutation        NONE
Remote Lark read/write/mutation    NONE
Queue send/retry/DLQ action        NONE
Worker deployment                  NOT_RUN
Schedule/route/workers.dev change  NONE
Customer LIVE UAT                  NOT_RUN
Production                         BLOCKED
PR merge                           NOT_PERFORMED
```

## Implementation result

```text
STATUS                              = PASS_FOR_INTEGRATION_REVIEW
OPERATOR_CONTRACT                   = chatwoot-remote-read-only-preflight-v1
OPERATOR_SOURCE                     = scripts/chatwoot-read-only-preflight-operator.mjs
PURE_CONTRACT_SOURCE                = scripts/lib/chatwoot-read-only-preflight-operator.js
FOCUSED_TEST                        = tests/application/chatwoot-read-only-preflight-operator.test.js
CODE_VERIFIED_HEAD                  = fce0028d0931eae79634d61bfc29ed4d14df8090
BRANCH_VERIFICATION                 = #657 / PASS
REMOTE_EXECUTION                    = NOT_RUN
REMOTE_MUTATION_COUNT               = 0
PROVIDER_REQUEST_COUNT              = 0
SECRET_VALUE_READ_COUNT             = 0
INTEGRATION_REVIEW                  = PASS_FOR_INTEGRATION_REVIEW
MERGE_DECISION                      = SEPARATE_AUTHORIZATION_REQUIRED
```

## Next gate

PR #109 remains Draft and unmerged. Repository merge alone does not authorize the Remote preflight.
The actual read-only run requires a separate exact authorization and an environment with read-only
Cloudflare credentials, the exact active Worker version and approved Chatwoot identity fingerprints.
