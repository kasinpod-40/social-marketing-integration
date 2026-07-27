# Current Task — Chatwoot Integration Runtime Wiring

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_PASS_INTEGRATION_REVIEW_PENDING
CURRENT_PROGRAM                     = CHATWOOT_INTEGRATION_RUNTIME_WIRING
BASE_MAIN                           = 90e367e88a4aad2a443683ca511951a67590ce90
INTEGRATION_BRANCH                  = integration/chatwoot-safe-wiring
DRAFT_PR                            = #97 / OPEN / DRAFT / UNMERGED
FOUNDATION_PR                       = #68 / MERGED
FOUNDATION_MERGE_COMMIT             = 80601de973740e8654b2cea2c4ecf419f4378c0a
WOOCOMMERCE_INTEGRATION_PR          = #94 / MERGED
WOOCOMMERCE_MERGE_COMMIT            = 060977cd9ed2933700fbd121c9236e6578ad571e
YOUTUBE_OPERATOR_CLOSEOUT_MAIN      = 90e367e88a4aad2a443683ca511951a67590ce90
LATEST_MERGED_MIGRATION             = 0017_woocommerce_commerce.sql
CHATWOOT_MIGRATION                  = 0018_chatwoot_analytics.sql / SOURCE_ONLY
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
CODE_VERIFIED_HEAD                  = c8b83d71fd26f86abf203d5ed427a4056ac4af43
CODE_BRANCH_VERIFICATION            = #648 / 30264683036 / PASS
PROVIDER_EXECUTION                  = NOT_RUN
TOKEN_READ_OR_ROTATION              = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT_RUN
PRODUCTION                          = BLOCKED
MERGE_INTO_MAIN                     = NOT_AUTHORIZED
```

## Objective completed

The reviewed Chatwoot analytics foundation is wired through the existing Shared Worker,
Reliability, Queue/DLQ, D1, Coverage and Lark contracts. The implementation allocates additive
Migration `0018`, adds the protected manual-only runtime route and default-false configuration, and
stops before every Provider or Remote action.

Detailed contracts:

```text
docs/tasks/chatwoot-end-to-end.md
docs/tasks/chatwoot-integration-wiring.md
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

The YouTube Worker dry-run operator Current Task that preceded this work is preserved without
replacing its Business facts at:

```text
docs/archive/current-task-before-chatwoot-runtime-wiring-after-youtube-operator-2026-07-27.md
```

The older TikTok predecessor already remains in its canonical archive on `main`; no duplicate
Chatwoot-named copy is retained.

## Completed repository scope

- Added replay-safe `migrations/0018_chatwoot_analytics.sql` with 14 PII-minimized tables and
  additive indexes.
- Added strict Chatwoot runtime configuration. Provider identity and Token are not read while the
  Connector gate is false.
- Promoted Chatwoot Connector and Job to `uat_pending`; Job remains `manualOnly`.
- Added account-scoped Stable Queue identity:
  `chatwoot:<accountKey>:<operationId>`.
- Preserved exact operation ID, Work key, generation and original request time across continuation.
- Preserved the deterministic Chatwoot `syncRunId` in both the live result and resumable completion
  so replay evidence cannot degrade to an undefined identifier.
- Added lazy `D1ChatwootAnalyticsStore` construction to Shared infrastructure.
- Added a dedicated Chatwoot top-level route with the existing WooCommerce route as fallback.
- Registered 15 Chatwoot logical Lark table keys without Remote Base mutation.
- Added default-false example configuration and focused runtime/Migration regressions.
- Reused Shared Reliability, distributed lock, generation fence, resumable work, Queue retry/DLQ,
  D1 Coverage, incremental checkpoint, Lark repository and `TableSyncEngine`.

## Locked route order

```text
Chatwoot
→ WooCommerce
→ YouTube
→ Google Ads
→ Meta
→ TikTok / reports / active fallback
```

Non-Chatwoot routing remains unchanged.

## Default-false controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Connector-disabled execution fails before Provider credential access. D1/Lark/Report flags never
implicitly enable Connector, Schedule or Webhook. Webhook remains unsupported and Schedule remains
disabled.

## Data and execution invariants

- Message body, names, email, phone, identifiers, addresses, attachment details, raw Label title,
  arbitrary attributes, raw Provider payload and Secrets are excluded from durable storage and logs.
- D1 state/facts complete before the first optional Lark Business write.
- Daily/Report writes require both the Report gate and `fullSnapshot=true`.
- Lark-disabled execution creates no Lark repository or table mapping.
- Coverage remains Partial until all enabled required sinks succeed, then Coverage entities and
  Complete status are persisted before the checkpoint advances.
- Lock loss, generation mismatch, retryable failures and partial sink failures reuse Shared
  fail-closed behavior.
- Missing metrics remain `null` unless the Source contract proves a real zero.
- No second Reliability, Queue/DLQ, D1 writer, Coverage store, Lark client or sync engine exists.

## Migration audit

```text
FILE                                = migrations/0018_chatwoot_analytics.sql
CREATE_TABLE_IF_NOT_EXISTS          = 14
DESTRUCTIVE_DROP                    = 0
DELETE_FROM                         = 0
ALTER_TABLE                         = 0
REMOTE_APPLY                        = NOT_RUN
RAW_PROVIDER_PAYLOAD_COLUMN         = NONE
MESSAGE_BODY_COLUMN                 = NONE
DIRECT_CONTACT_PII_COLUMN           = NONE
TOKEN_OR_SECRET_COLUMN              = NONE
```

## Verification result

Code head `c8b83d71fd26f86abf203d5ed427a4056ac4af43` passed Branch Verification
`#648` / run `30264683036` after alignment with current `main` and after the deterministic
`syncRunId` regression fix.

```text
Install locked dependencies         PASS
Syntax / architecture / hygiene     PASS
Focused staged TikTok               4 / 4 PASS
Node Unit / Integration             1038 / 1038 PASS
Workers runtime                     11 / 11 PASS
Report reliability                  91 / 91 PASS
Dependency audit                    0 vulnerabilities
Wrangler deployment dry-run         PASS / no deployment
Diagnostics upload                  PASS
Artifact                            8652302684
Artifact digest                     sha256:7f0991284534f75c4f129cf3007f100a4f1216547ebf7f2f16c1ace25c716ed1
```

The full Node suite contains 38 Chatwoot-named contract, normalizer, API client, D1, sync, routing,
configuration, Migration and resumable-identity tests; all passed. A separate literal ad-hoc
`node --test ...chatwoot...` command was not exposed by the connected Branch Verification workflow;
this is recorded accurately rather than claiming a standalone command that did not run.

An earlier aligned run found one stale Job Catalog expectation that still treated Chatwoot as
`planned`. The production contract was correct; the regression test was updated to assert the new
`uat_pending`, `manualOnly` state. Later verification passed completely.

## Remote safe state

```text
Chatwoot Provider/API request       NOT_RUN
Customer Token access/rotation      NOT_RUN
Remote D1 query/backup/apply        NOT_RUN
Remote D1 Business mutation         NONE
Remote Lark schema/data mutation    NONE
Queue send/retry/DLQ action         NONE
Worker deployment                   NOT_RUN
Schedule/Webhook activation         NONE
Customer/Production LIVE UAT        NOT_RUN
Production                          BLOCKED
```

## Remaining review gate

The final documentation head must pass exact-head Branch Verification. PR `#97` remains Draft and
unmerged. Repository verification does not authorize Remote D1 backup/apply, Lark schema work,
credential preflight, Worker deployment, Queue processing, LIVE UAT, Schedule/Webhook activation or
Production.

## Implementation result

```text
STATUS                              = IMPLEMENTATION_PASS_INTEGRATION_REVIEW_PENDING
FINAL_MAIN_SHA                      = 90e367e88a4aad2a443683ca511951a67590ce90
CODE_VERIFIED_HEAD                  = c8b83d71fd26f86abf203d5ed427a4056ac4af43
AHEAD_BEHIND_AT_CODE_REVIEW         = AHEAD / BEHIND 0
FILES_CHANGED_AT_CODE_REVIEW        = 18
MIGRATION_AUDIT                     = PASS / 14 TABLES / NON-DESTRUCTIVE
CHATWOOT_TESTS_IN_FULL_SUITE        = 38 / 38 PASS
FULL_NODE_TESTS                     = 1038 / 1038 PASS
WORKERS_RUNTIME_TESTS               = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
DEPENDENCY_AUDIT                    = 0 VULNERABILITIES
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
REMOTE_ACTIONS                      = NONE
INTEGRATION_REVIEW                  = PENDING_EXACT_FINAL_HEAD
```
