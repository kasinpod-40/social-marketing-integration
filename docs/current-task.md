# Current Task — Chatwoot Remote Read-only Preflight

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_OPERATOR_IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
BASE_MAIN                           = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                              = integration/chatwoot-remote-read-only-preflight
DRAFT_PR                            = TO_OPEN
CHATWOOT_RUNTIME_PR                 = #97 / MERGED
CHATWOOT_RUNTIME_MERGE_COMMIT       = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
CHATWOOT_CLOSEOUT_PR                = #108 / MERGED
CHATWOOT_CLOSEOUT_MERGE_COMMIT      = f3e330339b114536c3a1a9ee7567abf5a76fa78b
MIGRATION_0017                      = APPLIED / DO_NOT_RERUN
MIGRATION_0018                      = SOURCE_ONLY / EXPECTED_PENDING
REMOTE_PREFLIGHT_EXECUTION          = NOT_RUN
REMOTE_MUTATION_AUTHORIZED          = false
PRODUCTION                          = BLOCKED
```

The previous Chatwoot Runtime Wiring Merge Closeout is preserved at:

```text
docs/archive/current-task-before-chatwoot-remote-read-only-preflight-2026-07-27.md
```

## Objective

เพิ่ม guarded Operator สำหรับตรวจ Remote Integration Workspace แบบ read-only ก่อน Backup หรือ
Apply Migration `0018_chatwoot_analytics.sql`. Operator ต้องยืนยัน exact repository/Worker target,
active version, Remote Chatwoot flags, identity fingerprints, Secret names, D1 migration ledger,
Queue consumers, Cron และ workers.dev state โดยไม่มี Chatwoot Provider request หรือ Remote mutation.

Complete contract:

```text
docs/tasks/chatwoot-remote-read-only-preflight.md
```

## Scope

Repository implementation only:

- plan-only default operator;
- executable `preflight` phase with exact confirmation;
- exact reviewed Git HEAD and clean Working Tree gate;
- local Wrangler strict dry-run bundle hash;
- Remote Worker deployment/version metadata reads;
- Remote plain-text flag and non-secret identity fingerprint validation;
- Secret-name-only inspection;
- Remote D1 migration list and applied-ledger SELECT;
- Queue consumer metadata reads;
- Worker script, Cron and workers.dev reads;
- sanitized private Evidence under ignored `outputs/`;
- focused tests and full Repository verification.

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

Base URL และ external Account ID ต้องตรวจด้วย SHA-256 fingerprints เท่านั้น. Evidence ห้ามมีค่าจริง.

## Required all-false flags

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

## Migration contract

```text
0017_woocommerce_commerce.sql = applied
0018_chatwoot_analytics.sql   = not applied
0018_chatwoot_analytics.sql   = only pending migration
unexpected pending migration  = none
```

## Secret contract

Required name only:

```text
CHATWOOT_API_ACCESS_TOKEN
```

Optional names for a later Lark parity phase:

```text
LARK_APP_ID
LARK_APP_SECRET
```

Secret values, Authorization headers and raw bindings must never be output or persisted.

## Operator phases

```text
plan       = local plan only / default
preflight  = read-only Remote inspection after exact confirmation
```

Exact confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT=PREFLIGHT_CHATWOOT_REMOTE_READ_ONLY
```

## Prohibited actions

```text
Chatwoot Provider/API request
Customer Token value read or rotation
Remote D1 backup
Migration 0018 apply
Remote D1 Business mutation
Remote Lark read/write/schema mutation
Queue send/retry/DLQ action
Worker deployment
Schedule/route/workers.dev mutation
Customer LIVE UAT
Production
PR merge
```

## Required tests

- plan-only and exact confirmation;
- exact Integration Workspace target;
- active Worker version at 100% traffic;
- Remote plain-text var parsing;
- all six Chatwoot flags false;
- Base URL/Account ID fingerprint match;
- Secret-name-only validation;
- applied `0017` and exactly pending `0018`;
- Queue consumer identity/count;
- Worker/Cron/workers.dev contract;
- deterministic sanitized Evidence;
- static proof of no Provider, migration apply, deployment or Queue send path;
- full Node/Workers/report/audit/Wrangler gates.

## Implementation result

```text
STATUS                              = IN_PROGRESS
OPERATOR_CONTRACT                   = chatwoot-remote-read-only-preflight-v1
OPERATOR_SOURCE                     = scripts/chatwoot-read-only-preflight-operator.mjs
PURE_CONTRACT_SOURCE                = scripts/lib/chatwoot-read-only-preflight-operator.js
FOCUSED_TEST                        = tests/application/chatwoot-read-only-preflight-operator.test.js
REMOTE_EXECUTION                    = NOT_RUN
REMOTE_MUTATION_COUNT               = 0
PROVIDER_REQUEST_COUNT              = 0
INTEGRATION_REVIEW                  = PENDING_VERIFICATION
```

## Next gate

Complete Repository verification on the exact final head. A Repository merge does not authorize the
Remote preflight execution. The actual read-only run requires a separate exact authorization and an
environment that has read-only Cloudflare credentials plus the approved identity fingerprints.
