# Current Task — Chatwoot Integration Runtime Wiring

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS_BY_CHATGPT_WORK
CURRENT_PROGRAM                     = CHATWOOT_INTEGRATION_RUNTIME_WIRING
BASE_MAIN                           = 1ec60980c3897f01cef9bdc5f24aa6f5b7eba295
INTEGRATION_BRANCH                  = integration/chatwoot-safe-wiring
DRAFT_PR                            = #97 / OPEN / DRAFT
FOUNDATION_PR                       = #68 / MERGED
FOUNDATION_MERGE_COMMIT             = 80601de973740e8654b2cea2c4ecf419f4378c0a
WOOCOMMERCE_INTEGRATION_PR          = #94 / SQUASH_MERGED
WOOCOMMERCE_MERGE_COMMIT            = 060977cd9ed2933700fbd121c9236e6578ad571e
LATEST_MERGED_MIGRATION             = 0017_woocommerce_commerce.sql
CHATWOOT_MIGRATION                  = 0018_chatwoot_analytics.sql / TO_CREATE_SOURCE_ONLY
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
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

## Objective

Wire the reviewed and merged Chatwoot analytics foundation through the existing Shared Worker,
Reliability, Queue/DLQ, D1, Coverage and Lark contracts. Allocate additive Migration `0018`, add the
protected manual-only runtime route and default-false configuration, verify the exact branch head,
and stop before every Provider or Remote action.

Detailed implementation contract:

```text
docs/tasks/chatwoot-end-to-end.md
docs/tasks/chatwoot-integration-wiring.md
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

## Authority and reading order

1. `AGENTS.md`
2. this file
3. `PROJECT_BRAIN.md`
4. the detailed Chatwoot records above
5. current Shared Worker/config/Queue/Reliability/D1/Lark implementation and tests

Repository state is authoritative over chat history. Inspect duplicate logic, dead files, route
ordering, batching, retry/lock/generation behavior, privacy and partial-failure semantics before
adding code.

## Approved repository-only scope

- Create replay-safe `migrations/0018_chatwoot_analytics.sql` for 14 approved PII-minimized tables.
- Add strict Chatwoot runtime configuration for the Integration Workspace and Chemistry K target.
- Promote Chatwoot Connector and Job to `uat_pending`; Job remains `manualOnly`.
- Reuse central Queue operation identity and preserve account/run/generation/request identity.
- Add lazy `D1ChatwootAnalyticsStore` construction to Shared runtime infrastructure.
- Add Chatwoot as the top-level route with the current WooCommerce route as fallback.
- Register 15 approved Chatwoot Lark logical keys without Remote Base mutation.
- Add empty/default-false examples only.
- Add focused route, gate, lock, retry, Coverage, checkpoint, migration and regression tests.
- Run repository CI and update the Implementation result below.

## Locked route order

```text
Chatwoot
→ WooCommerce
→ YouTube
→ Google Ads
→ Meta
→ TikTok / reports / active fallback
```

Non-Chatwoot execution must preserve the existing chain and behavior.

## Required default-false controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Connector disabled must fail before Provider credential access. Storage or Report flags must never
enable Connector, Schedule or Webhook implicitly. Webhook remains unsupported and Schedule disabled.

## Data and execution invariants

- No Message body, name, email, phone, identifier, address, attachment detail, raw Label title,
  arbitrary attributes, raw Provider payload or Secret may be persisted or logged.
- D1 state/facts complete before the first Lark Business write.
- Daily/Report writes require both Report gate and `fullSnapshot=true`.
- Lark-disabled execution constructs no Lark repository/table mapping.
- Coverage starts Partial, finalizes Complete only after every enabled required sink, and checkpoint
  advances last.
- Lock loss, generation mismatch, retryable failure and partial sink failure reuse Shared behavior and
  fail closed.
- Missing metrics remain `null` unless the approved contract proves real zero.
- No duplicate Reliability, Queue/DLQ, D1 writer, Coverage store, Lark client or sync engine.

## Out of scope and prohibited actions

```text
Chatwoot Provider/API request       NOT_AUTHORIZED
Customer Token read/rotation        NOT_AUTHORIZED
Remote D1 query/backup/apply        NOT_AUTHORIZED
Remote D1 Business mutation         NOT_AUTHORIZED
Remote Lark schema/data mutation    NOT_AUTHORIZED
Queue send/retry/DLQ action         NOT_AUTHORIZED
Worker deployment                   NOT_AUTHORIZED
Schedule/Webhook activation         NOT_AUTHORIZED
Customer/Production LIVE UAT        NOT_AUTHORIZED
Production                          BLOCKED
Draft PR merge                      NOT_AUTHORIZED
```

Do not create temporary workflows, placeholders, generated outputs, local config, Secrets or unrelated
Business-fact edits.

## Acceptance criteria

- Migration `0018` is additive, replay-safe, PII-minimized and free of destructive SQL.
- Chatwoot Connector/Job are `uat_pending`; the Job is manual-only.
- Exact environment/profile/customer/account validation occurs before Provider access.
- The Chatwoot top-level route preserves every existing fallback route.
- Shared Reliability, Queue/DLQ, lock, generation, D1, Coverage and Lark engines are reused.
- D1-before-Lark, Partial-to-Complete Coverage and checkpoint-last semantics are proven by tests.
- All flags default false and fail closed.
- Full Branch Verification passes on the exact final head.
- No Provider, Remote or LIVE action occurs.
- Draft PR remains unmerged for Integration Review.

## Implementation result

```text
STATUS                              = IN_PROGRESS
FINAL_MAIN_SHA                      = PENDING
FINAL_HEAD_SHA                      = PENDING
AHEAD_BEHIND                        = PENDING
FILES_CHANGED                       = PENDING
MIGRATION_AUDIT                     = PENDING
FOCUSED_CHATWOOT_TESTS              = PENDING
FULL_NODE_TESTS                     = PENDING
WORKERS_RUNTIME_TESTS               = PENDING
REPORT_RELIABILITY                  = PENDING
DEPENDENCY_AUDIT                    = PENDING
WRANGLER_DRY_RUN                    = PENDING
DIFF_CHECK                          = PENDING
REMOTE_ACTIONS                      = NONE_EXPECTED
INTEGRATION_REVIEW                  = PENDING
```

Previous Current Task archive:

```text
docs/archive/current-task-before-chatwoot-runtime-wiring-2026-07-27.md
```
