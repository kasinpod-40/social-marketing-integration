# Chatwoot Integration Runtime Wiring

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS_BY_CHATGPT_WORK
WORKSTREAM                          = CHATWOOT_INTEGRATION_RUNTIME_WIRING
BASE_MAIN                           = 1ec60980c3897f01cef9bdc5f24aa6f5b7eba295
BRANCH                              = integration/chatwoot-safe-wiring
DRAFT_PR                            = #97
FOUNDATION_PR                       = #68 / MERGED
FOUNDATION_MERGE_COMMIT             = 80601de973740e8654b2cea2c4ecf419f4378c0a
WOOCOMMERCE_INTEGRATION_PR          = #94 / MERGED
WOOCOMMERCE_MERGE_COMMIT            = 060977cd9ed2933700fbd121c9236e6578ad571e
LATEST_MERGED_MIGRATION             = 0017_woocommerce_commerce.sql
CHATWOOT_MIGRATION                  = 0018_chatwoot_analytics.sql / TO_CREATE
REMOTE_EXECUTION                    = NOT_AUTHORIZED
```

## Objective

Integrate the reviewed Chatwoot analytics foundation into the existing Shared Worker, D1, Queue,
Reliability and Lark contracts without creating a second runtime framework. This is repository-only
implementation and stops before Provider or Remote actions.

## Required reading

1. `AGENTS.md`
2. `docs/current-task.md`
3. `PROJECT_BRAIN.md`
4. `docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md`
5. `docs/tasks/chatwoot-end-to-end.md`
6. current Shared Worker/config/Queue/Reliability/D1/Lark source and tests

## In scope

### Additive D1 migration

Create `migrations/0018_chatwoot_analytics.sql` for:

```text
chatwoot_account_state
chatwoot_inbox_state
chatwoot_contact_state
chatwoot_agent_state
chatwoot_team_state
chatwoot_label_state
chatwoot_conversation_state
chatwoot_conversation_label_state
chatwoot_message_analytics_state
chatwoot_reporting_event_facts
chatwoot_conversation_daily_facts
chatwoot_agent_daily_facts
chatwoot_inbox_daily_facts
chatwoot_account_daily_facts
```

Migration must be replay-safe, additive and PII-minimized. Only `CREATE TABLE IF NOT EXISTS` and
additive indexes are allowed. No `DROP`, `DELETE`, destructive `ALTER`, generic raw JSON payload or
Remote apply.

### Runtime configuration

Add strict Chatwoot runtime configuration validating:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
customer_key=chemistry_k
account_key non-empty
HTTPS base URL
exact external account ID
trigger=manual_uat
```

The API token remains Secret-only and must not be read when the Connector gate is false.

All controls default false:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

### Shared catalogs and identity

- Chatwoot Connector becomes `uat_pending`.
- `CHATWOOT_CONVERSATIONS_SYNC` becomes `uat_pending` and `manualOnly: true`.
- Reuse central Queue operation helpers.
- Stable identity preserves `accountKey`, `operationId`, `generation`, original `requestedAt` and run scope.
- Malformed identity/schema/continuation is a Permanent error.

### Shared infrastructure and route

- Lazy-create `D1ChatwootAnalyticsStore` only for the Chatwoot route.
- Reuse `MKT_STATE_DB`, incremental state, resumable work, Reliability, lock/generation fence,
  Coverage, Lark repository and `TableSyncEngine`.
- Add Chatwoot as top-level route with current WooCommerce route as fallback.

Locked route order:

```text
Chatwoot
→ WooCommerce
→ YouTube
→ Google Ads
→ Meta
→ TikTok / reports / active fallback
```

Provider reads must not begin before Connector and target validation. D1 finishes before Lark.
Report/Daily datasets require the Report gate and `fullSnapshot=true`. Coverage starts Partial,
becomes Complete only after enabled required sinks, and checkpoint advances last. Webhook remains
unsupported and Schedule disabled.

### Lark logical registry

Register only these logical keys; do not apply Remote Base changes:

```text
rawChatwootAccounts
rawChatwootInboxes
rawChatwootContacts
rawChatwootAgents
rawChatwootTeams
rawChatwootLabels
rawChatwootConversations
rawChatwootConversationLabels
rawChatwootMessageAnalytics
rawChatwootReportingEvents
mktConversations
mktConversationDaily
mktAgentDaily
mktInboxDaily
mktConversationAccountDaily
```

Examples may contain empty placeholders/default-false values only. Never commit real Table IDs,
base URL, account ID or token.

## Required tests

- Connector/Job status and manual-only behavior
- all-false rejection before credential/Provider access
- exact environment/profile/customer/account validation
- Chatwoot route selection and fallback isolation
- lazy D1/Lark dependency construction
- Connector/D1/Lark/Report/checkpoint gate combinations
- Report gate requiring `fullSnapshot=true`
- D1-before-Lark ordering
- Partial Coverage on D1/Lark failure
- checkpoint last and blocked on failure
- retry/lock/generation fail-closed behavior through Shared contracts
- stable continuation identity and rerun idempotency
- migration inventory and destructive-SQL audit
- no regression to existing routes

## Expected areas

```text
migrations/0018_chatwoot_analytics.sql
packages/config/src/chatwoot-runtime-config.js
packages/config/src/connector-catalog.js
packages/config/src/lark-table-config.js
packages/application/src/jobs/job-catalog.js
packages/application/src/jobs/queue-operation.js
apps/sync-worker/src/runtime-infrastructure.js
apps/sync-worker/src/chatwoot-job-router.js
apps/sync-worker/src/chatwoot-active-job-router.js
apps/sync-worker/src/sync-worker.js
.dev.vars.example
wrangler.sync.example.jsonc
tests/application/chatwoot-runtime-wiring.test.js
docs/current-task.md
```

The final set must remain minimal after codebase inspection.

## Prohibited actions

```text
Chatwoot Provider/API request
Customer Token access/rotation
Remote D1 query/backup/migration/write
Remote Lark schema/data mutation
Queue send/retry/DLQ action
Worker deployment
Schedule/Webhook activation
Customer/Production LIVE UAT
Production changes
Draft PR merge
```

## Acceptance criteria

- Migration `0018` is additive, PII-minimized and contract-complete.
- Chatwoot Connector/Job are `uat_pending` and manual-only.
- The top-level route preserves the complete fallback chain.
- All gates default false and fail before unauthorized side effects.
- Shared Reliability, Queue/DLQ, lock, generation, D1, Coverage and Lark engines are reused.
- D1-before-Lark, Partial-to-Complete Coverage and checkpoint-last semantics are tested.
- Exact-head Branch Verification passes.
- No Remote or Provider action occurs.
- PR #97 remains Draft and unmerged for Integration Review.
