# Chatwoot End-to-End Integration

## Authoritative workstream status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION_REVIEW
WORKSTREAM                           = CHATWOOT_END_TO_END
DRAFT_PR                             = #68
BRANCH                               = agent/chatwoot-end-to-end
INITIAL_IMPLEMENTATION_BASE_SHA      = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
REMEDIATION_HEAD_BEFORE_ALIGNMENT    = c6812dd92c5f6963204b69f294348a6156e092c5
CURRENT_MAIN_ALIGNMENT_SHA           = 6158a8b1381d62539274a7fa77d7860bdbee624a
ALIGNMENT_PR                         = #90
ALIGNED_CODE_HEAD                    = efc9fc8b801fbd2272aee15e20f075af6391c77e
REMEDIATION_DOCUMENTATION_HEAD       = c2a26cc32bf19d11f40d2ef99e58867d54c0ec4f
BRANCH_BEHIND_MAIN_AT_CLOSEOUT       = 0
LATEST_MIGRATION_OBSERVED            = 0016_tiktok_post_lark_pipeline.sql
CHATWOOT_MIGRATION                   = NOT_CREATED / INTEGRATION_RESERVED
CONNECTOR_RUNTIME                    = NOT_WIRED
REMOTE_D1                            = NOT_TOUCHED
REMOTE_LARK                          = NOT_TOUCHED
QUEUE_SEND                           = NONE
DEPLOYMENT                           = NONE
SCHEDULE                             = DISABLED
WEBHOOK                              = DISABLED / UNSUPPORTED
LIVE_UAT                             = NOT_PERFORMED
PR_68_MERGE                          = NOT_PERFORMED
```

PR `#68` remains Draft. Alignment PR `#90` merged current `main` into the Chatwoot feature branch
only; it did not merge Chatwoot into `main` and performed no runtime or Remote action.

## Objective and boundaries

Provide a bounded Chatwoot Application API polling foundation that prepares:

- PII-minimized current state and immutable analytics facts;
- deterministic Stable keys, Source revisions and idempotent reruns;
- sink-aware Coverage evidence;
- optional Lark state writes through the existing `TableSyncEngine`;
- separately gated Daily/Report facts from an explicitly approved full snapshot.

Worker routing, Queue/DLQ, shared Reliability, generation fencing, numbered Migration allocation,
shared table registry, Customer mapping, deployment and LIVE UAT remain separately authorized
Integration work.

## Shared authority reused

- shared `permanentError` / `transientError` classification;
- shared `createStableFingerprint`;
- existing incremental checkpoint contract;
- existing `data_coverage_runs` / `data_coverage_entities` contract and store;
- existing `TableSyncEngine.planByKey()` / `executePlan()`;
- existing Chatwoot Connector, Job and Source foundation;
- future existing Reliability runner, distributed lock, generation fence, Queue retry and DLQ boundary.

No second Reliability engine, Queue framework, generic D1 writer, Lark engine or Report engine was
introduced.

## Integration Review remediation result

The original Draft received `CHANGES_REQUIRED / NOT_PASS_FOR_INTEGRATION`. Every blocker recorded in
that review is now addressed and covered by regression tests.

### Message history

- Initial Messages response is treated as Chatwoot's latest bounded page, not complete history.
- Earlier rows are collected with strictly decreasing `before` cursors.
- Forward `after` remains available to the API transport but is not used as an unproven initial baseline.
- Duplicate, repeated, non-decreasing and out-of-range cursors fail Permanently.
- Page and per-conversation row limits remain bounded and fail closed.
- Regression covers more than 20 messages and multiple backward pages.

### HTTP retry classification

- HTTP status is classified before strict JSON parsing.
- `408`, `425`, `429`, `500`, `502`, `503`, `504` remain Retryable when the provider body is empty,
  HTML or otherwise non-JSON.
- Error-body JSON is parsed best-effort only.
- A successful malformed response remains a Permanent Source-contract failure.

### Reporting metrics

- Every selected Conversation reads its own reporting events.
- Old first-response, resolution and reply evidence is not discarded because it falls outside the
  incremental overlap.
- Account reporting transport retains bounded `since` and `until` parameters for future approved range
  reads.
- A newer Conversation revision cannot replace existing response metrics with `null` merely because
  only recent account events were loaded.

### Daily grain and null semantics

- Message counts use the Message creation local date.
- Response, Resolution and Reply metrics use the Reporting Event end local date.
- New Conversation uses the Conversation creation local date.
- Reopen uses the confirmed newer status-transition revision date.
- Conversation update time no longer moves cumulative Message volume into a later date.
- Empty input creates no invented zero Account Daily row.
- Historical active-Agent, active-Inbox and status-snapshot values remain `null` when the Source does
  not prove the period fact.
- Daily rows remain `data_status=partial` until a separately approved complete historical
  assignment/status event contract exists.
- Daily/Report writes require `fullSnapshot=true`.

### Gate isolation

```text
Connector gate             explicit before Provider reads
D1 gate                     explicit before state/fact writes
Checkpoint gate             explicit before durable admission
Lark gate                   independent and optional
Report gate                 independent; requires full snapshot
Webhook gate                unsupported; true fails Permanently
Schedule                    not wired
```

Report disabled means the four Daily datasets are absent from both D1 writes and Lark plans. Lark
disabled means no Lark repository, engine or table mapping is required.

### D1 scale, identity and idempotency

- Conversation-state and Conversation-Label reads are batched at no more than 500 IDs.
- Regression covers 501 selected Conversations.
- `first_seen_at` and `created_at` are preserved on rerun.
- State updates remain Source-revision gated.
- Immutable account/entity identity participates in conflict handling.
- An identity conflict is re-read and fails Permanently as
  `CHATWOOT_IMMUTABLE_IDENTITY_CONFLICT`; it is never silently skipped.
- A stale revision with matching identity remains an idempotent skip.
- Reopen count increments only on a strictly newer `resolved -> non-resolved` transition.

### Coverage finalization

```text
partial Coverage
→ required D1 writes
→ optional required Lark writes
→ Coverage entities
→ complete Coverage
→ checkpoint
```

D1 or Lark failure leaves only Partial Coverage and cannot advance the checkpoint. Complete Coverage
is written only after every enabled required sink succeeds.

### PII minimization

Never persisted:

- Contact/Agent name, email, phone, identifier, address, avatar or IP;
- Message body, processed content, transcript, quote or search text;
- Attachment URL, filename, thumbnail, coordinates, transcription or nested metadata;
- unrestricted custom/additional attributes;
- website token, callback URL, credentials, authorization header or raw request/response body;
- raw Chatwoot Label title.

Label association uses opaque Label ID. Normalized Label title exists only transiently to calculate a
stable `title_hash`.

## Source contract

### Authentication and identity

- GET-only Chatwoot Application API.
- `api_access_token` is sent only in the request header.
- Exact mapping is `(base_url, external_account_id) -> customer_key/account_key`.
- Provider IDs are opaque positive identities normalized to text.
- Secret, credential and direct PII must not enter Source control, Queue payloads, D1, Lark, logs,
  errors, tests or documentation.

### Endpoints

```text
/api/v1/accounts/{account_id}/inboxes
/api/v1/accounts/{account_id}/agents
/api/v1/accounts/{account_id}/teams
/api/v1/accounts/{account_id}/labels
/api/v1/accounts/{account_id}/contacts?page={n}&sort=-last_activity_at
/api/v1/accounts/{account_id}/conversations?page={n}&status=all&assignee_type=all
/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?before={message_id}
/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?after={message_id}
/api/v1/accounts/{account_id}/conversations/{conversation_id}/labels
/api/v1/accounts/{account_id}/conversations/{conversation_id}/reporting_events
/api/v1/accounts/{account_id}/reporting_events?page={n}&since={s}&until={s}
```

### Incremental policy

```text
cursor_key          = chatwoot:{account_key}:analytics
default overlap     = 48 hours
incremental scope   = bounded newest Conversation and resolved-Contact pages
full snapshot       = explicit approved mode only
Message baseline    = bounded backward history per selected Conversation
missing page row    = not deletion evidence
```

Source-record hash includes Stable key, Source revision and normalized metadata/metrics hashes. It
excludes observation, first-seen and last-seen timestamps so unchanged Source data retains the same
hash across reruns.

## Proposed additive Data Model

No numbered Migration was added by PR `#68`.

### Current state and immutable facts

```text
chatwoot_account_state
chatwoot_inbox_state
chatwoot_contact_state                  # resolved-contact observations only
chatwoot_agent_state
chatwoot_team_state
chatwoot_label_state                    # title_hash; no raw title
chatwoot_conversation_state
chatwoot_conversation_label_state       # active and explicit removed state
chatwoot_message_analytics_state        # no Message content
chatwoot_reporting_event_facts
```

### Optional Daily facts

```text
chatwoot_conversation_daily_facts
chatwoot_agent_daily_facts
chatwoot_inbox_daily_facts
chatwoot_account_daily_facts
```

Stable identities are scoped by `chatwoot:{account_key}:...`; Daily identities append local
`metric_date`.

## Coverage datasets

```text
chatwoot.accounts                  recent_window | full_inventory
chatwoot.inboxes                   recent_window | full_inventory
chatwoot.resolved_contacts         exact_entities
chatwoot.agents                    recent_window | full_inventory
chatwoot.teams                     recent_window | full_inventory
chatwoot.labels                    recent_window | full_inventory
chatwoot.conversations             recent_window | full_inventory
chatwoot.conversation_labels       recent_window | full_inventory
chatwoot.messages                  recent_window | full_inventory
chatwoot.reporting_events          recent_window | full_inventory
chatwoot.conversation_daily        report_range
chatwoot.agent_daily               report_range
chatwoot.inbox_daily               report_range
chatwoot.account_daily             report_range
```

The Contacts endpoint is represented as `resolved_contacts` with `exact_entities`, never as proven
complete all-Contact inventory.

## Proposed Lark targets

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
mktAgentDaily                   -> MKT_Agent_Daily
mktInboxDaily                   -> MKT_Inbox_Daily
mktConversationAccountDaily     -> MKT_Conversation_Account_Daily
```

No shared table registry or Remote Base was changed.

## Proposed runtime flags — default false

```env
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Storage and Report flags never enable Connector or Schedule implicitly.

## Files changed

```text
docs/tasks/chatwoot-end-to-end.md
packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js
packages/application/src/use-cases/sync-chatwoot-analytics.js
packages/connectors/src/chatwoot/chatwoot-analytics-normalizers.js
packages/connectors/src/chatwoot/chatwoot-api.client.js
packages/connectors/src/chatwoot/d1-chatwoot-analytics-store.js
tests/application/chatwoot-analytics-contract.test.js
tests/application/sync-chatwoot-analytics.test.js
tests/connectors/chatwoot-api-client.test.js
tests/connectors/d1-chatwoot-analytics-store.test.js
```

No reserved shared file is changed by PR `#68`.

## Verification evidence

### Remediation head before main alignment

Head `c6812dd92c5f6963204b69f294348a6156e092c5` — Branch Verification `#598` / run
`30242812199`: PASS.

### Aligned code head

Head `efc9fc8b801fbd2272aee15e20f075af6391c77e` — Branch Verification `#603` / run
`30243052754`: PASS.

### Remediation documentation head

Head `c2a26cc32bf19d11f40d2ef99e58867d54c0ec4f` — Branch Verification `#606` / run
`30243183211`: PASS.

Verified gates:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok regression     4 / 4 PASS
Node Unit / Integration              951 / 951 PASS
Workers runtime                       9 / 9 PASS
Report reliability                   91 / 91 PASS
Dependency audit                     0 vulnerabilities
Wrangler deploy dry-run              PASS / no deployment
Diagnostics upload                   PASS
```

The resulting closeout-document head must retain a successful PR Branch Verification check; the PR
check on the exact head is the authority and does not require another content-only closeout commit.

## Remote actions not performed

- no Customer Chatwoot token or Provider request;
- no Worker deployment;
- no numbered or Remote D1 Migration;
- no Remote D1 Business mutation;
- no Remote Lark schema or record mutation;
- no Queue send, retry or DLQ action;
- no Cron/Schedule or Webhook activation;
- no Cloudflare or Production Secret change;
- no Customer/Production LIVE UAT;
- no Merge of PR `#68` into `main`.

## Integration follow-up

A later explicitly authorized Integration task must:

1. refresh `main`, open PRs and Migration sequence;
2. allocate/review the next additive Chatwoot Migration;
3. approve/apply D1 and Lark schema separately with backup and read-back evidence;
4. add exact non-secret Customer Account/Inbox mappings and Secret provisioning;
5. wire the existing Worker Reliability/lock/generation/Queue/DLQ boundary behind all false flags;
6. deploy flags-false only under explicit approval;
7. perform read-only exact identity and permission preflight;
8. validate bounded state-only sync, exact rerun, late update, Label removal, rate limit, lock loss,
   partial sink and Coverage;
9. validate an approved full-snapshot Daily/Report run separately;
10. keep Schedule and Webhook disabled until Customer LIVE UAT, reconciliation and rollback gates pass.

**Decision: `PASS_FOR_INTEGRATION_REVIEW`. PR `#68` remains Draft and unmerged.**
