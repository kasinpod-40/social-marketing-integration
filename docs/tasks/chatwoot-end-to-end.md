# Chatwoot End-to-End Integration

## Task metadata

```text
TASK_STATUS                 = IMPLEMENTATION_COMPLETE_DRAFT_REVIEW_PENDING
WORKSTREAM                   = CHATWOOT_END_TO_END
BRANCH                       = agent/chatwoot-end-to-end
DRAFT_PR                     = #68
IMPLEMENTATION_BASE_SHA      = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
REVIEW_MAIN_OBSERVED_SHA     = ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4
LATEST_MIGRATION_OBSERVED    = 0016_tiktok_post_lark_pipeline.sql
CHATWOOT_MIGRATION           = NOT_CREATED / INTEGRATION_CHAT_RESERVED
CONNECTOR_RUNTIME            = NOT_WIRED
RUNTIME_FLAGS                = ALL_FALSE / PROPOSED_ONLY
WEBHOOK                      = FUTURE_SCOPE / FAIL_CLOSED
REMOTE_D1                    = NOT_TOUCHED
REMOTE_LARK                  = NOT_TOUCHED
QUEUE_SEND                   = NONE
DEPLOYMENT                   = NONE
SCHEDULE                     = DISABLED
LIVE_UAT                     = NOT_PERFORMED
MERGE                        = NOT_PERFORMED
```

Implementation started from the exact `main` SHA above. While the workstream was open, `main`
advanced through the TikTok Organic post-Lark merge/closeout. PR merge-ref verification succeeded
against that newer `main`; no Chatwoot workstream file conflicts with the merged TikTok files.
Integration Chat must still refresh `main`, open PRs and the migration sequence before allocating the
Chatwoot migration or wiring runtime.

## Objective and boundaries

Implement a production-like, bounded polling foundation for Chatwoot Application API data that:

- reads account-scoped metadata and analytics source records;
- minimizes PII before any durable boundary;
- normalizes stable current-state and reporting entities;
- prepares D1, Coverage, Canonical daily and Lark write sets;
- uses the existing `TableSyncEngine`, incremental checkpoint and Coverage contracts;
- leaves Reliability, Queue/DLQ, lock, generation fence and Worker routing to the existing shared
  runtime boundary.

This workstream does **not** connect a real customer account, use a real token, deploy, apply a remote
migration, mutate remote Lark/D1, send Queue work, enable a schedule/webhook or run Live UAT.

## Repository audit

Read and checked before implementation:

- `AGENTS.md`, `docs/current-task.md`, `PROJECT_BRAIN.md` and storage architecture docs;
- `README.md`, root scripts and Branch Verification workflow;
- Connector and Job catalogs, connector registry and runtime configuration;
- Worker entrypoint, Queue router, scheduler boundary and runtime infrastructure;
- Reliability runner, resumable work, generation/lock and incremental cursor stores;
- D1 marketing history/Coverage contracts;
- `TableSyncEngine`, Lark repository and shared table registry;
- existing Chatwoot source contract, fixture and tests;
- open Draft PRs and latest migration sequence.

Existing Chatwoot foundation was retained and extended. No second Reliability engine, Queue
framework, generic D1 writer, Canonical writer or Lark sync engine was introduced.

### Existing shared helpers reused

- `permanentError` and `transientError`;
- `createStableFingerprint`;
- existing `D1IncrementalStateStore` checkpoint interface;
- existing `data_coverage_runs` / `data_coverage_entities` validation and persistence;
- existing `TableSyncEngine.planByKey()` / `executePlan()`;
- future existing Worker Reliability, lock, generation fence, Queue retry and DLQ boundary;
- existing Chatwoot connector key, job type and source contract.

## Source contract

### Authentication and exact identity

- GET-only Chatwoot Application API.
- `api_access_token` is sent only in the request header.
- Runtime secret must never enter Source, Queue payload, D1, Lark, logs, errors, fixture or docs.
- Exact mapping is `(base_url, external_account_id) -> customer_key/account_key`.
- Account, inbox and entity IDs are treated as opaque positive IDs and normalized to text.
- Account reporting events require a sufficiently privileged account user; permission failure is
  Permanent and must not be represented as empty data.

### Endpoints

```text
/api/v1/accounts/{account_id}/inboxes
/api/v1/accounts/{account_id}/agents
/api/v1/accounts/{account_id}/teams
/api/v1/accounts/{account_id}/labels
/api/v1/accounts/{account_id}/contacts?page={n}&sort=-last_activity_at
/api/v1/accounts/{account_id}/conversations?page={n}&status=all&assignee_type=all
/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?after={message_id}
/api/v1/accounts/{account_id}/conversations/{conversation_id}/labels
/api/v1/accounts/{account_id}/reporting_events?page={n}
```

### Pagination and bounded polling

- Conversations and Contacts use integer pages and declared-total completion checks.
- Account reporting events use integer pages and provider page metadata.
- Messages use forward-only `after`; IDs must increase strictly.
- Metadata lists are bounded non-paginated reads.
- Every request has timeout, response-byte cap, max attempts, max pages and max rows.
- No arbitrary provider-returned URL is followed.
- Per selected conversation, messages are read from the first page through a bounded in-run `after`
  cursor so current message totals are deterministic. The implementation deliberately does not
  persist a message-only delta cursor because applying deltas as totals would corrupt conversation
  counts. A conversation exceeding the configured bound fails closed and requires a separately
  designed durable continuation before Production.

### Incremental and late-update policy

```text
cursor_key          = chatwoot:{account_key}:analytics
source watermark    = maximum accepted source updated/activity/reporting timestamp
default overlap     = 48 hours
full reconciliation = separate manual/scheduled policy after approval
```

The reviewed Conversation List contract does not provide an approved `updated_since` parameter.
The implementation therefore reads bounded newest pages, filters records against
`lastSuccessfulSyncAt - overlap`, and recomputes selected conversations. This repairs late status,
reopen, assignment, team, label and duration changes. Missing rows from one incremental page are not
interpreted as deleted.

### Retry classification

Retryable:

- network, timeout and response-stream failures;
- HTTP `408`, `425`, `429`, `500`, `502`, `503`, `504`;
- D1 operational failures.

Permanent:

- invalid/non-HTTPS remote URL or missing mapping/token;
- HTTP `400`, `401`, `403`, `404` contract/identity/permission failures;
- malformed JSON or response shape;
- repeated/non-increasing page/message cursor;
- page, row, response-size or per-conversation message bound exceeded;
- unknown label mapping, unsupported status/message/event type or account identity drift.

The connector does not retry or acknowledge Queue messages. Integration Chat must wrap it with the
existing Reliability, lock, generation fence, Queue retry and DLQ contracts.

## PII minimization

Never persisted:

- message body, processed content, transcript, quote or search text;
- attachment URL, filename, thumbnail, coordinates, transcription or metadata;
- contact/agent name, email, phone, identifier, address, avatar or IP;
- contact custom/additional attributes or source/contact-inbox token;
- inbox website token, callback URL, phone number, scripts or provider credentials;
- token, authorization header, raw request/response body or arbitrary nested payload JSON.

Allowed analytics fields:

- opaque external IDs and source timestamps;
- status, priority, inbox/channel, assignee/team and availability/role enums;
- normalized label ID/title/color;
- message direction/type/content category, private flag, sender role and attachment count;
- response/resolution/reply durations, counts, hashes and lineage.

All durable hashes are calculated from the normalized allowlisted object, not the raw provider body.

## Data model

The schema below is a proposal only. Integration Chat must allocate the next available migration
number after refreshing `main` (currently expected after migration `0016`). No migration file is
created in this workstream.

### RAW/current tables

| Table | Primary key / stable key | Required analytics fields |
|---|---|---|
| `chatwoot_account_state` | `chatwoot:{account}:account:{id}` | account identity, seen/source timestamps, hash, Coverage/Sync lineage |
| `chatwoot_inbox_state` | `chatwoot:{account}:inbox:{id}` | channel, medium, timezone, operating booleans, timestamps/hash/lineage |
| `chatwoot_contact_state` | `chatwoot:{account}:contact:{id}` | opaque ID, blocked/availability/source status, timestamps/hash/lineage |
| `chatwoot_agent_state` | `chatwoot:{account}:agent:{id}` | opaque ID, role/availability/confirmed flags, timestamps/hash/lineage |
| `chatwoot_team_state` | `chatwoot:{account}:team:{id}` | opaque ID, auto-assign flag, timestamps/hash/lineage |
| `chatwoot_label_state` | `chatwoot:{account}:label:{id}` | ID, normalized title/color/sidebar flag, timestamps/hash/lineage |
| `chatwoot_conversation_state` | `chatwoot:{account}:conversation:{id}` | inbox/contact/assignee/team IDs, status/priority, message counts, durations, reopen count, revision/hash/lineage |
| `chatwoot_conversation_label_state` | `{conversation_key}:label:{label_id}` | conversation/label IDs, active/observed/removed state, lineage |
| `chatwoot_message_analytics_state` | `chatwoot:{account}:message:{id}` | conversation/inbox IDs, direction/type/category/private/sender role, attachment count, timestamps/hash/lineage |
| `chatwoot_reporting_event_facts` | `chatwoot:{account}:reporting_event:{id}` | event name, wall/business duration, conversation/inbox/agent IDs, event/source timestamps/hash/lineage |

Current-state upsert is gated by non-decreasing `source_updated_at`. Same key and same normalized hash
is idempotent. Immutable identity conflict is Permanent. Reopen count increases only for a newer
`resolved -> non-resolved` source revision.

### Canonical daily tables

| Table | Primary key | Grain and metrics |
|---|---|---|
| `chatwoot_conversation_daily_facts` | `{conversation_key}:{metric_date}` | one observed conversation/date; status, opened/resolved/reopened, message counts and durations |
| `chatwoot_agent_daily_facts` | `chatwoot:{account}:agent:{id}:{date}` | assigned/resolved/reopened, message volume, average supported durations |
| `chatwoot_inbox_daily_facts` | `chatwoot:{account}:inbox:{id}:{date}` | conversation/new/resolved/reopened, message volume, average supported durations |
| `chatwoot_account_daily_facts` | `chatwoot:{account}:account:{date}` | status counts, new/reopened, message volume, averages, active agent/inbox counts |

### Metric definitions and null semantics

- Conversation count: distinct stable conversation key in the declared date/scope.
- New conversation: `created_at` falls on reporting date.
- Resolved: trusted resolved state/event for the date.
- Reopen: newer transition from `resolved` to `open|pending|snoozed`.
- First response, resolution and reply time: provider reporting-event seconds.
- Business-hours duration: provider `value_in_business_hours`; never inferred from wall time.
- Message volume: count of minimal allowlisted message records by direction/type.
- Agent/inbox performance: deterministic aggregate of normalized daily facts.
- Missing metric is `null`; observed source zero remains `0`.
- Average is never presented as median and business/non-business durations are not mixed.

### Deleted/merged contacts and assignment changes

- A missing contact from an incremental page is not deleted.
- `merged`/`deleted` requires explicit source evidence or an approved full reconciliation policy.
- Assignment/team/status/label updates replace current state only when source revision is newer.
- Late updates are recomputed within the overlap window.

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
chatwoot.messages
chatwoot.reporting_events
chatwoot.conversation_daily
chatwoot.agent_daily
chatwoot.inbox_daily
chatwoot.account_daily
```

- Existing Coverage contracts are reused.
- Incremental runs emit `scope_mode=recent_window`; approved full runs emit `full_inventory`.
- Coverage run/entity keys match existing shared validators.
- `complete` requires exact expected/observed row/entity counts and zero failures.
- Page/cursor/limit/write failure cannot produce completed Coverage.
- Checkpoint advances only after D1, required Coverage and every required Lark plan complete.
- Retry after a partial result replays stable keys.

## Lark target mapping

Proposed logical/physical targets; no shared registry or remote Base was changed:

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

Rows are planned/executed only through existing `TableSyncEngine`. Exact table IDs are required
before writes and remain Environment configuration.

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

Storage flags must not implicitly enable Connector or Schedule. Webhook remains unsupported and must
fail closed.

## Reserved-file integration patch proposal

Integration Chat, on a conflict-aware integration branch, must review and separately apply:

1. allocate the next additive migration after refreshed `main` and create proposed D1 tables/indexes;
2. add exact Lark logical table IDs only after schema approval/apply/read-back;
3. move Chatwoot Connector/Job status from `planned` to `uat_pending`, never directly to `active`;
4. wire the processor behind all false-by-default gates;
5. inject existing Reliability, distributed lock, generation fence, Queue retry/DLQ, incremental,
   Coverage and Lark dependencies;
6. keep Webhook and Schedule disabled;
7. add non-secret exact account/inbox mapping to shared customer profile only after approval;
8. optionally add a root focused test script after resolving root `package.json` ownership.

No reserved file was edited in this branch.

## Files changed

```text
docs/tasks/chatwoot-end-to-end.md
packages/connectors/src/chatwoot/chatwoot-api.client.js
packages/connectors/src/chatwoot/chatwoot-analytics-normalizers.js
packages/connectors/src/chatwoot/d1-chatwoot-analytics-store.js
packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js
packages/application/src/use-cases/sync-chatwoot-analytics.js
tests/connectors/chatwoot-api-client.test.js
tests/connectors/d1-chatwoot-analytics-store.test.js
tests/application/chatwoot-analytics-contract.test.js
tests/application/sync-chatwoot-analytics.test.js
```

## Implementation result and verification

Implementation completed on Draft PR `#68`. Final implementation head
`1a40b57ac9d35932cfd56e08976f15afebb98550` passed Branch Verification `#538` against GitHub's PR
merge ref on the newer `main`:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok regression     4 / 4 PASS
Node Unit / Integration              879 / 879 PASS
Workers runtime                       9 / 9 PASS
Report reliability                   91 / 91 PASS
Dependency audit                     0 vulnerabilities
Wrangler deploy dry-run              PASS / no deployment
Diagnostics upload                   PASS
```

The suite includes Chatwoot API pagination/retry/token tests, PII/Coverage/daily contracts, D1
adapter fail-closed and retry behavior, source-revision reopen SQL, explicit processing gates,
existing fixture regressions and D1 -> Lark -> checkpoint ordering. Any later documentation-only
head must retain a successful Branch Verification run before Integration Review closes.

Local execution was limited to `node --check` on new JavaScript/test files because this environment
has no authenticated local repository checkout or `gh`. Full command evidence comes from GitHub
Actions. `git diff --check` is represented by the repository hygiene/check gate; Integration Chat
must rerun exact local commands after checkout before merge.

## Integration Chat rollout after merge approval

1. refresh `main`, PRs and migration sequence; review final PR diff and unresolved discussions;
2. run `npm ci`, `npm run check`, `npm test`, focused Chatwoot tests,
   `npm run test:report-reliability`, `npm audit --audit-level=high`,
   `npm run deploy:dry-run`, `git diff --check`;
3. approve/apply additive D1 schema and Lark Blueprint separately with backups/read-back;
4. provision secrets without committing or logging them;
5. deploy with every Chatwoot execution flag false;
6. run read-only exact account/inbox identity and permission preflight;
7. run bounded manual tests for first sync, exact rerun, pagination, late update, reopen,
   assignment/label change, 429/5xx, lock loss, partial write, retry/DLQ and Coverage;
8. validate large message/conversation limits and design durable continuation before Production;
9. enable D1 and Lark writes in separate guarded stages while Schedule remains false;
10. run customer-owned Live UAT and reconciliation;
11. only then propose `active` catalog status and a bounded polling schedule.

Stop at Draft PR and wait for Integration Review. This workstream must not merge itself.
