# Chatwoot End-to-End Integration

## Task metadata

```text
TASK_STATUS              = IMPLEMENTATION_IN_PROGRESS
WORKSTREAM                = CHATWOOT_END_TO_END
BRANCH                    = agent/chatwoot-end-to-end
BASE_BRANCH               = main
BASE_SHA                  = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
CONNECTOR                 = chatwoot
QUEUE_JOB                 = chatwoot.conversations.sync
RUNTIME_FLAGS_DEFAULT     = false
WEBHOOK                   = FUTURE_SCOPE
PRODUCTION                = BLOCKED
REMOTE_D1                 = NOT_TOUCHED
REMOTE_LARK               = NOT_TOUCHED
QUEUE_SEND                = NONE
DEPLOYMENT                = NONE
SCHEDULE                  = DISABLED
LIVE_UAT                  = NOT_PERFORMED
```

## Objective

Implement a production-like, polling-based Chatwoot ingestion boundary that can fetch bounded
Application API pages, minimize PII, normalize stable entities and analytics facts, prepare D1 and
Lark write sets, generate deterministic daily reporting rows and reuse the existing Reliability,
Incremental cursor, Coverage and `TableSyncEngine` contracts.

This branch must remain disconnected from the shared Worker entrypoint, shared scheduler, shared Job
Catalog and live infrastructure. Integration Chat must review and apply the reserved-file patch
proposal before any runtime activation.

## Repository audit

### Required sources read

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- `README.md`
- root `package.json`
- Connector/Job catalogs, runtime configuration and connector registry
- Shared Queue routing, Reliability runner, resumable work and incremental cursor stores
- `TableSyncEngine`, Lark repository and D1 Storage adapters
- Existing Chatwoot contract, fixture and tests

### Verified repository state

```text
main                                      e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
latest source migration                   0015_google_ads_live_admission.sql
open Draft PR #17                         Google Ads / HOLD / not a reusable baseline
open Draft PR #11                         obsolete and superseded / must not merge
existing Chatwoot connector catalog       planned
existing Chatwoot job catalog             planned
existing Chatwoot source foundation       present
existing Chatwoot runtime route           absent
existing Chatwoot D1/Lark schema          absent
```

### Existing helpers reused

- `permanentError` / `transientError` for typed provider and storage failures
- `createStableFingerprint` for source hashes and idempotency
- `runReliableSync` as the required runtime wrapper; this branch does not create another runner
- `D1IncrementalStateStore` for post-business-write cursor commits
- `D1ResumableWorkStore` and Queue generation fences at the future Worker integration boundary
- existing Queue/DLQ router and Queue operation contracts
- `data_coverage_runs` / `data_coverage_entities` through the existing marketing history store
- `TableSyncEngine.planByKey()` / `executePlan()` for Lark plan/diff/write
- `LarkRecordRepository` for schema-aware serialization and bounded writes
- existing `CHATWOOT_SOURCE_CONTRACT`, Connector key and Job type

## Source contract analysis

### Authentication and identity

- Use Chatwoot Application API read endpoints with `api_access_token` in the request header.
- Token is required from Secret storage at runtime and must never enter Source, Queue payload, D1,
  Lark, fixture, logs, errors or reconciliation JSON.
- Exact runtime mapping is `(base_url, external_account_id) -> customer_key/account_key`.
- Account, inbox and entity IDs are treated as opaque positive identifiers and converted to text.
- Platform API credentials are not assumed. Account identity is verified from account-scoped
  Application API payloads; optional Platform API account lookup is a separately approved preflight.

### GET-only endpoints used by the source client

```text
/api/v1/accounts/{account_id}/inboxes
/api/v1/accounts/{account_id}/agents
/api/v1/accounts/{account_id}/teams
/api/v1/accounts/{account_id}/labels
/api/v1/accounts/{account_id}/contacts?page={n}&sort=-last_activity_at
/api/v1/accounts/{account_id}/conversations?page={n}&status=all&assignee_type=all
/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?after={message_id}
/api/v1/accounts/{account_id}/conversations/{conversation_id}/labels
/api/v1/accounts/{account_id}/conversations/{conversation_id}/reporting_events
/api/v1/accounts/{account_id}/reporting_events?page={n}
```

### Pagination and bounded polling

- Conversations: integer page cursor; stop on empty payload or when declared total is exhausted.
- Contacts: fixed provider page size; stop on empty payload or when `meta.count` is exhausted.
- Account reporting events: integer page cursor and `meta.total_pages`.
- Messages: forward-only `after` message ID; each response is capped by the provider. Repeated or
  non-increasing message cursors are permanent contract errors.
- Metadata lists (inboxes, agents, teams, labels) are bounded non-paginated reads.
- Every list method enforces `maxPages`, `maxRows`, response-byte limit, timeout and retry attempts.
- The source client never follows arbitrary response URLs.

### Incremental and late-update policy

```text
cursor_key              = chatwoot:{account_key}:analytics
source watermark        = max(conversation.updated_at, reporting_event.updated_at)
incremental overlap      = 48 hours by default
full reconciliation     = separately scheduled/manual policy, never inferred from missing rows
message cursor           = highest accepted message ID per conversation
```

Chatwoot's conversation list does not expose an approved `updated_since` parameter in the reviewed
contract. Incremental mode therefore polls newest pages in a bounded window, filters by
`updated_at >= cursor - overlap`, and stops only after a complete page falls older than the overlap
boundary. The overlap repairs late status, reopen, assignment, team, label and resolution changes.
A periodic bounded full reconciliation remains required before Production.

### Retry classification

Retryable:

- network/timeout/stream read failure;
- HTTP `408`, `425`, `429`, `500`, `502`, `503`, `504`;
- bounded provider throttling with `Retry-After`.

Permanent:

- malformed base URL or non-HTTPS remote URL;
- missing token/account mapping;
- `400`, `401`, `403`, `404` identity/permission/schema errors;
- malformed JSON or unexpected response shape;
- repeated/non-increasing page or message cursor;
- configured page/row/response-size ceiling exceeded.

The future Worker route must run this use case inside existing Reliability, lock, generation fence,
Queue retry and DLQ handling. The connector code does not acknowledge, retry or send Queue messages.

## PII minimization contract

### Never persisted

- message `content`, `processed_message_content`, transcript, quote or search text;
- attachment URL, filename, thumbnail, coordinates, transcription or metadata;
- contact/agent name, available name, email, phone, identifier, address, IP, avatar or thumbnail;
- contact `additional_attributes`, `custom_attributes`, source ID or contact-inbox token;
- inbox website token, callback webhook URL, phone number, provider credentials or script;
- access token, authorization header, request/response body dump;
- arbitrary conversation/message/contact nested payload JSON.

### Allowed analytics fields

- opaque external IDs;
- source timestamps;
- status, priority, inbox/channel type;
- assignee/team IDs and role/availability enums;
- label IDs/titles only after label allowlist mapping;
- message direction/type, private flag, content type category, sender role and attachment count;
- counts, durations, business-hours durations, reopen count and daily aggregates;
- hashes calculated only from the allowlisted normalized object.

## Data model

All D1 names below require an additive migration proposed as `0016_chatwoot_analytics.sql`. This
workstream does not create or renumber the migration because the migration sequence is reserved for
Integration Chat.

### RAW/current tables

#### `chatwoot_account_state`

Grain and key:

```text
one row per mapped Chatwoot account
account_state_key = chatwoot:{account_key}:account:{external_account_id}
PRIMARY KEY(account_state_key)
UNIQUE(account_key, external_account_id)
```

Required fields:

```text
account_state_key, customer_key, account_key, external_account_id,
source_base_host_hash, first_seen_at, last_seen_at, source_updated_at,
metadata_hash, last_coverage_run_id, last_sync_run_id, created_at, updated_at
```

No account display name is required for analytics storage.

#### `chatwoot_inbox_state`

```text
inbox_key = chatwoot:{account_key}:inbox:{inbox_id}
PRIMARY KEY(inbox_key)
UNIQUE(account_key, external_inbox_id)
```

Fields: customer/account IDs, external inbox ID, `channel_type`, `medium`, timezone,
auto-assignment/working-hours/CSAT booleans, availability status, source timestamps, metadata hash,
coverage and sync references. Do not store website token, URL, callback URL, phone or greeting text.

#### `chatwoot_contact_state`

```text
contact_key = chatwoot:{account_key}:contact:{contact_id}
PRIMARY KEY(contact_key)
UNIQUE(account_key, external_contact_id)
```

Fields: customer/account IDs, external contact ID, blocked flag, availability enum,
created/last-activity/source-updated timestamps, source availability
`available|merged|deleted|unknown`, metadata hash, coverage and sync references.
No direct or hashed name/email/phone/identifier is stored.

A contact missing from one incremental page is not deleted. `merged` or `deleted` requires explicit
provider evidence or a separately approved full-reconciliation rule.

#### `chatwoot_agent_state`

```text
agent_key = chatwoot:{account_key}:agent:{agent_id}
PRIMARY KEY(agent_key)
UNIQUE(account_key, external_agent_id)
```

Fields: external agent ID, role, availability status, auto-offline, confirmed, custom-role ID,
first/last seen, metadata hash, coverage and sync references. Names and emails are excluded.

#### `chatwoot_team_state`

```text
team_key = chatwoot:{account_key}:team:{team_id}
PRIMARY KEY(team_key)
UNIQUE(account_key, external_team_id)
```

Fields: external team ID, auto-assign flag, first/last seen, metadata hash, coverage/sync references.
Team name/description are excluded from D1 analytics state unless Integration approves a display
mapping table in Lark.

#### `chatwoot_label_state`

```text
label_key = chatwoot:{account_key}:label:{label_id}
PRIMARY KEY(label_key)
UNIQUE(account_key, external_label_id)
```

Fields: external label ID, normalized title, color, sidebar flag, first/last seen, metadata hash,
coverage/sync references. Label descriptions are excluded.

#### `chatwoot_conversation_state`

```text
conversation_key = chatwoot:{account_key}:conversation:{conversation_id}
PRIMARY KEY(conversation_key)
UNIQUE(account_key, external_conversation_id)
```

Required fields:

```text
conversation_key, customer_key, account_key, external_account_id,
external_conversation_id, external_inbox_id, status, created_at_source,
updated_at_source, last_activity_at, source_availability_status,
message_count, incoming_message_count, outgoing_message_count,
private_message_count, attachment_message_count, reopen_count,
first_response_seconds, first_response_business_seconds,
resolution_seconds, resolution_business_seconds, reply_seconds,
assignee_id, team_id, priority, waiting_since,
metrics_hash, metadata_hash, last_coverage_run_id, last_sync_run_id,
created_at, updated_at
```

Status transitions are latest-state updates. `resolved -> open|pending|snoozed` increments reopen
only when a newer source update confirms the transition. Retry of the same source revision does not.
Assignment and team changes update current state and are represented in daily snapshots.

#### `chatwoot_conversation_label_state`

```text
conversation_label_key = chatwoot:{account_key}:conversation:{conversation_id}:label:{label_id}
PRIMARY KEY(conversation_label_key)
```

Fields: conversation key, label key/ID, observed/removed timestamps, active flag, coverage/sync refs.
A full label read for a conversation is authoritative for that conversation only.

#### `chatwoot_message_analytics_state`

```text
message_key = chatwoot:{account_key}:message:{message_id}
PRIMARY KEY(message_key)
UNIQUE(account_key, external_message_id)
```

Fields: conversation/inbox IDs, message type/direction, content type category, private flag,
sender type/agent ID, source created/updated timestamps, attachment count, metadata hash,
coverage/sync refs. No body or attachment details.

#### `chatwoot_reporting_event_facts`

```text
reporting_event_key = chatwoot:{account_key}:reporting_event:{event_id}
PRIMARY KEY(reporting_event_key)
UNIQUE(account_key, external_reporting_event_id)
```

Fields: event name, duration seconds, business-hours seconds, event start/end, conversation/inbox/agent
IDs, source created/updated timestamps, payload hash, coverage/sync refs. Supported names are
`first_response`, `resolution`, `reply_time`; unknown names may be retained only after an explicit
contract extension.

### Canonical/master tables

#### `chatwoot_conversation_daily_facts`

```text
conversation_daily_key = chatwoot:{account_key}:conversation:{conversation_id}:{metric_date}
PRIMARY KEY(conversation_daily_key)
```

One row per conversation per reporting date. Fields: status-at-observation, opened/resolved/reopened
counts, incoming/outgoing/private/attachment message counts, first-response/resolution/reply seconds,
assignee/team/inbox IDs, data status, coverage/source revision/fetched/sync timestamps.

#### `chatwoot_agent_daily_facts`

```text
agent_daily_key = chatwoot:{account_key}:agent:{agent_id}:{metric_date}
PRIMARY KEY(agent_daily_key)
```

Fields: assigned conversation count, resolved count, reopened count, incoming/outgoing reply count,
average/median first-response seconds when source-supported, average resolution/reply seconds,
data status and lineage.

#### `chatwoot_inbox_daily_facts`

```text
inbox_daily_key = chatwoot:{account_key}:inbox:{inbox_id}:{metric_date}
PRIMARY KEY(inbox_daily_key)
```

Fields: conversation/resolved/reopened counts, incoming/outgoing counts, average first-response,
resolution and reply seconds, data status and lineage.

#### `chatwoot_account_daily_facts`

```text
account_daily_key = chatwoot:{account_key}:account:{metric_date}
PRIMARY KEY(account_daily_key)
```

Fields: total/new/open/resolved/pending/snoozed/reopened conversations, incoming/outgoing messages,
average first-response/resolution/reply seconds, active agents/inboxes, data status and lineage.

### Metric definitions

- Conversation count: distinct conversation key in the date/scope.
- New conversation: source `created_at` falls on metric date.
- Resolved conversation: resolution event ends on metric date or trusted resolved transition occurs.
- Reopen count: trusted transition from `resolved` to non-resolved with newer source revision.
- First response time: provider `first_response` event `value` seconds; missing remains `null`.
- Resolution time: provider `resolution` event `value` seconds; missing remains `null`.
- Reply time: provider `reply_time` event `value` seconds; missing remains `null`.
- Business-hours duration: provider `value_in_business_hours`; never derived from wall-clock duration.
- Message volume: count of allowlisted minimal message records by direction/type; body is never needed.
- Agent/inbox performance: deterministic aggregate of daily facts or provider summary reports, with
  source lineage declaring which method produced the row.
- Missing metric is `null`; an observed source zero is `0`.
- Average values never substitute for median and never mix business/non-business durations.

### Idempotency and late revision rules

- Current-state UPSERT is gated by non-decreasing `source_updated_at`.
- Fact UPSERT uses stable fact/event keys and source payload hashes.
- Same key + same hash is skipped.
- Same key + newer source revision updates the row.
- Same key + conflicting immutable identity is Permanent.
- Daily fact recomputation is deterministic from normalized facts inside the bounded overlap.
- Checkpoint advances only after D1 and all required Lark plans complete.
- Cursor retry after partial D1/Lark work replays the same stable keys.

## Coverage and reconciliation

Datasets:

```text
chatwoot.accounts
chatwoot.inboxes
chatwoot.contacts
chatwoot.agents
chatwoot.teams
chatwoot.labels
chatwoot.conversations
chatwoot.conversation_labels
chatwoot.message_analytics
chatwoot.reporting_events
chatwoot.conversation_daily
chatwoot.agent_daily
chatwoot.inbox_daily
chatwoot.account_daily
```

Each dataset emits one existing `data_coverage_runs` row with expected/observed/written/failed counts
and bounded source watermark. Entity-level proof uses existing `data_coverage_entities`.

A run is `complete` only when every fetched page is validated and every required D1/Lark table is
reconciled. A bounded incremental run may be `partial` by time coverage but must be complete for its
declared overlap scope. Missing pages, repeated cursors, row-limit exhaustion, unresolved table
mapping or failed write never report success.

## Lark target mapping

Proposed logical/physical targets; shared registry changes are reserved for Integration Chat:

```text
rawChatwootAccounts              -> RAW_Chatwoot_Accounts
rawChatwootInboxes               -> RAW_Chatwoot_Inboxes
rawChatwootContacts              -> RAW_Chatwoot_Contacts
rawChatwootAgents                -> RAW_Chatwoot_Agents
rawChatwootTeams                 -> RAW_Chatwoot_Teams
rawChatwootLabels                -> RAW_Chatwoot_Labels
rawChatwootConversations         -> RAW_Chatwoot_Conversations
rawChatwootConversationLabels    -> RAW_Chatwoot_Conversation_Labels
rawChatwootMessageAnalytics      -> RAW_Chatwoot_Message_Analytics
rawChatwootReportingEvents       -> RAW_Chatwoot_Reporting_Events
mktConversations                 -> MKT_Conversations
mktConversationDaily            -> MKT_Conversation_Daily
mktAgentDaily                    -> MKT_Agent_Daily
mktInboxDaily                    -> MKT_Inbox_Daily
mktConversationAccountDaily     -> MKT_Conversation_Account_Daily
```

All Lark rows are generated as plain allowlisted objects and are planned/executed through the
existing `TableSyncEngine`. This workstream does not implement another Lark writer.

## Reserved-file integration patch proposal

Integration Chat must review and apply these changes in a separate conflict-aware integration branch:

1. `packages/config/src/connector-catalog.js`
   - move Chatwoot from `planned` to `uat_pending` after source/Data model review;
   - do not mark `active` until Live UAT and large-account gates pass.
2. `packages/application/src/jobs/job-catalog.js`
   - move `chatwoot.conversations.sync` from `planned` to `uat_pending`;
   - runtime activation remains protected/manual and schedule false.
3. Worker routing/runtime infrastructure
   - wire the isolated Chatwoot processor behind all Chatwoot write flags;
   - wrap it in existing Reliability, stable Queue operation, lock, generation fence and DLQ;
   - inject existing cursor/resumable/coverage/Lark dependencies;
   - do not modify generic Queue/DLQ semantics.
4. Migration sequence
   - allocate next migration number after rebasing current `main`;
   - add the D1 tables/indexes/constraints above additively;
   - no delete, rename or mutation of existing business facts.
5. Shared Lark table registry
   - add only the logical keys listed above after the Lark schema is approved/applied;
   - Table IDs remain Environment secrets/configuration.
6. Customer profile and Wrangler examples
   - exact Chatwoot account/inbox mappings are non-secret profile data;
   - token/base URL credentials remain secrets;
   - all Connector, D1, Lark and Schedule flags default `false`.
7. Shared scheduler
   - no schedule entry in this implementation;
   - add only after bounded polling UAT and cadence approval.
8. Root `package.json`
   - optional focused script proposal:
     `test:chatwoot = node --test tests/application/chatwoot-*.test.js tests/connectors/chatwoot-*.test.js tests/chatwoot/*.test.js`.

## Runtime flags proposed for Integration Chat

```env
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
CHATWOOT_BASE_URL=
CHATWOOT_ACCOUNT_ID=
CHATWOOT_API_ACCESS_TOKEN=
CHATWOOT_INCREMENTAL_OVERLAP_HOURS=48
CHATWOOT_MAX_PAGES=100
CHATWOOT_MAX_ROWS=5000
```

Enabling Storage flags must not enable the Connector or schedule. Webhook remains unsupported and
must fail closed.

## Acceptance criteria

- Existing Chatwoot foundation is extended rather than duplicated.
- GET-only source client has timeout, response cap, bounded retry and bounded pagination.
- PII allowlist excludes message bodies and contact/agent direct identifiers.
- Accounts/inboxes/contacts/agents/teams/labels/conversations/messages/reporting events normalize to
  stable keys.
- Incremental overlap supports late updates, reopen and assignment changes.
- D1 write set and Lark write set use the same normalized source lineage.
- Lark plans use existing `TableSyncEngine` only.
- Daily account/inbox/agent/conversation rows are deterministic and null-safe.
- Coverage and reconciliation counters are exact.
- No Worker entrypoint, scheduler, Job Catalog, Connector Catalog, customer profile, Wrangler,
  migration or Lark registry is directly edited in this branch.
- All runtime flags remain false because this branch is not wired to runtime.
- No Production/Customer API, real token, webhook, Queue send, Remote D1/Lark mutation, deploy,
  schedule or Live UAT occurs.

## Required verification

```bash
npm ci
npm run check
npm test
node --test \
  tests/application/chatwoot-*.test.js \
  tests/connectors/chatwoot-*.test.js \
  tests/chatwoot/*.test.js
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Pending source implementation and Branch Verification evidence.

## Integration Chat rollout steps after merge approval

1. Rebase against latest `main`; re-audit open PRs and migration sequence.
2. Review Data model and Lark Blueprint with exact field types/permissions.
3. Apply reserved-file integration patch on a dedicated integration branch.
4. Run all gates and executable local migration replay.
5. Back up Remote D1; apply additive migration only after explicit approval.
6. Apply/verify Lark schema separately with zero-drift read-back.
7. Provision secrets without exposing them in Git or logs.
8. Deploy with every Chatwoot execution flag false and verify disabled routes/schedule.
9. Run read-only exact account/inbox identity preflight.
10. Run bounded manual UAT: first sync, idempotent rerun, late-update/reopen/assignment repair,
    pagination/resume, provider 429/5xx, lock/retry/DLQ and Coverage reconciliation.
11. Enable D1 then Lark writes in separate guarded gates; keep schedule false.
12. Run 5,000-conversation production-like fixture and customer-owned Live UAT.
13. Only then consider `active` status and a bounded polling schedule.
