# Chatwoot End-to-End Integration

## Authoritative workstream status

```text
TASK_STATUS                         = REMEDIATED_ALIGNED_FINAL_REVIEW_PENDING
WORKSTREAM                           = CHATWOOT_END_TO_END
DRAFT_PR                             = #68
BRANCH                               = agent/chatwoot-end-to-end
INITIAL_IMPLEMENTATION_BASE_SHA      = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
REMEDIATION_HEAD_BEFORE_ALIGNMENT    = c6812dd92c5f6963204b69f294348a6156e092c5
CURRENT_MAIN_ALIGNMENT_SHA           = 6158a8b1381d62539274a7fa77d7860bdbee624a
ALIGNMENT_PR                         = #90
ALIGNED_BRANCH_HEAD                  = efc9fc8b801fbd2272aee15e20f075af6391c77e
BRANCH_BEHIND_MAIN                   = 0
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
FINAL_ALIGNED_VERIFICATION           = RUN_603_IN_PROGRESS
```

Draft PR `#68` remains the Chatwoot source workstream. Alignment PR `#90` merged current `main`
**into the feature branch only**. It did not merge PR `#68` into `main` and performed no runtime or
Remote action.

## Objective and boundaries

Provide a bounded, production-like Chatwoot Application API polling foundation that prepares:

- PII-minimized current state and immutable analytics facts;
- deterministic Stable keys and source revisions;
- sink-aware Coverage evidence;
- optional Lark state writes through the existing `TableSyncEngine`;
- separately gated Daily/Report facts only from an approved full snapshot.

The workstream deliberately leaves Worker routing, Queue/DLQ, shared Reliability, generation fencing,
Migration allocation, shared table registry, customer mapping, deployment and LIVE UAT to separately
authorized Integration tasks.

## Repository and shared-contract audit

Read before remediation:

1. `AGENTS.md`;
2. current `docs/current-task.md`;
3. `PROJECT_BRAIN.md` and relevant storage architecture;
4. `README.md` and `CHANGELOG.md`;
5. current Shared Reliability, Queue, D1, Coverage, Lark and Worker contracts;
6. full PR `#68` Diff, tests and open parallel workstreams.

Reused authority:

- `permanentError` / `transientError`;
- `createStableFingerprint`;
- existing incremental checkpoint contract;
- existing `data_coverage_runs` / `data_coverage_entities` validators and store;
- existing `TableSyncEngine.planByKey()` / `executePlan()`;
- future existing Reliability runner, distributed lock, generation fence, Queue retry and DLQ boundary;
- existing Chatwoot connector key, job type and source contract.

No second Reliability engine, Queue framework, generic D1 writer, Lark engine or Report engine was
created.

## Integration Review remediation

The original Draft received `CHANGES_REQUIRED / NOT_PASS_FOR_INTEGRATION`. The branch now contains the
following corrections.

### 1. Message history and pagination

- An initial Messages request is treated as Chatwoot's latest bounded page, not full history.
- Older history is read with strictly decreasing `before` cursors.
- Forward `after` remains available to the transport contract but is not misused as an initial baseline.
- Duplicate, repeated, non-decreasing or out-of-range cursors fail Permanently.
- Per-conversation pages and rows remain bounded; exceeding either limit fails closed.
- Tests cover history beyond 20 rows and multi-page backward collection.

### 2. Retry classification

- HTTP status is classified before strict success-body JSON parsing.
- `408`, `425`, `429`, `500`, `502`, `503`, `504` remain Retryable even when the provider body is empty,
  HTML or otherwise non-JSON.
- Error-body JSON is best-effort only and never required to preserve retry semantics.
- Successful malformed JSON remains a Permanent source-contract error.

### 3. Reporting-event preservation

- Selected conversations use the conversation reporting-events endpoint so an old first-response,
  resolution or reply event is not lost merely because it is outside the incremental overlap.
- Account reporting transport retains bounded `since` / `until` support for future approved range reads.
- A newer conversation state cannot replace durable response metrics with `null` because only recent
  account events were loaded.

### 4. Daily fact grain and null semantics

- Message counts are assigned to `message.source_created_at` local dates.
- First response, resolution and reply metrics are assigned to `event_end_at` local dates.
- New conversation is assigned to the conversation creation date.
- Reopen evidence uses the newer status-transition revision date.
- Conversation `updated_at` is no longer used to move cumulative message volume into a later date.
- An empty Source window creates no invented zero Account Daily row.
- Historical active-agent, active-inbox and status-snapshot values remain `null` where the Source does
  not prove a period fact.
- Daily rows currently declare `data_status=partial`; complete historical assignment/status semantics
  require an additional approved event contract.
- Daily/Report generation is permitted only for `fullSnapshot=true`.

### 5. Gate isolation

Execution gates are independent and fail closed:

```text
Connector gate             required before Provider reads
D1 write gate               required before state/fact writes
Checkpoint write gate       required before admission
Lark write gate             optional and does not enable Report
Report write gate           optional, requires full snapshot
Webhook gate                unsupported; true is Permanent failure
Schedule                    not wired
```

When Report is disabled, all four Daily targets are absent from both D1 write rows and Lark plans.
When Lark is disabled, no Lark dependency or table mapping is required.

### 6. D1 scale, identity and idempotency

- Conversation-state and conversation-label reads are split into batches of at most 500 IDs.
- Tests cover a selected window of 501 conversations.
- `first_seen_at` and `created_at` are preserved on rerun.
- Current-state updates remain source-revision gated.
- Immutable account/entity identity is part of the conflict predicate.
- A conflict is re-read and returned as Permanent
  `CHATWOOT_IMMUTABLE_IDENTITY_CONFLICT`, not silently skipped.
- A stale revision with matching identity remains an idempotent skip.
- Reopen count increases only on a strictly newer `resolved -> non-resolved` revision.

### 7. Coverage finalization

Coverage follows a two-stage sink contract:

```text
partial Coverage persisted
→ required D1 rows
→ optional required Lark plans
→ Coverage entities
→ complete Coverage finalized
→ incremental checkpoint
```

A D1 or Lark failure leaves only `partial` Coverage and cannot advance the checkpoint. Complete
Coverage is written only after every enabled required sink succeeds.

### 8. PII minimization

Never persisted:

- contact or agent name, email, phone, identifier, address, avatar or IP;
- message body, processed content, transcript, quote or search text;
- attachment URL, filename, thumbnail, coordinates, transcription or nested metadata;
- unrestricted custom/additional attributes;
- website token, callback URL, credentials, authorization header or raw request/response body;
- raw Chatwoot label title.

Label association uses opaque Label ID. The normalized label title exists only transiently to compute a
stable `title_hash`; raw free text does not cross the durable boundary.

## Source contract

### Authentication and identity

- GET-only Chatwoot Application API.
- `api_access_token` is sent only in the request header.
- Exact mapping is `(base_url, external_account_id) -> customer_key/account_key`.
- Account, Inbox, Conversation, Contact, Agent, Team, Label, Message and Reporting Event IDs are opaque
  positive identities normalized to text.
- Token, Secret or Customer PII must not appear in Source control, Queue payloads, D1, Lark, logs,
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
incremental scope   = bounded newest Conversation/Resolved-Contact pages
full snapshot       = explicit manual/approved mode only
message baseline    = bounded backward history per selected Conversation
missing page row    = not deletion evidence
```

Source-record hashes contain Stable key, Source revision and normalized metadata/metrics hashes only.
Observation time, first-seen time and last-seen time are excluded so an unchanged payload retains the
same hash across reruns.

## Proposed additive Data Model

No numbered Migration was added in this workstream.

### Current state / immutable facts

```text
chatwoot_account_state
chatwoot_inbox_state
chatwoot_contact_state                  # resolved-contact list observations only
chatwoot_agent_state
chatwoot_team_state
chatwoot_label_state                    # title_hash, never raw title
chatwoot_conversation_state
chatwoot_conversation_label_state       # active + explicit removed state
chatwoot_message_analytics_state        # no message content
chatwoot_reporting_event_facts
```

### Optional Daily facts

```text
chatwoot_conversation_daily_facts
chatwoot_agent_daily_facts
chatwoot_inbox_daily_facts
chatwoot_account_daily_facts
```

Stable identities remain scoped by `chatwoot:{account_key}:...`; Daily identities append the local
`metric_date`.

## Coverage datasets and scopes

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

The Contacts endpoint is not represented as complete all-contact inventory. It is explicitly named
`resolved_contacts` and uses `exact_entities` Coverage.

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

No shared registry or Remote Base was changed. Exact table IDs remain required before any future Lark
write.

## Proposed runtime flags — defaults remain false

```env
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Storage and Report flags never enable Connector or Schedule implicitly.

## Files changed in PR #68

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

Remediation head `c6812dd92c5f6963204b69f294348a6156e092c5` passed Branch Verification
`#598` / run `30242812199` before alignment:

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

Focused remediation tests cover:

- non-JSON `429` / `503` retry;
- initial latest-20 and backward Message history pagination;
- deterministic Source hash across different observation times;
- label-title PII exclusion;
- event/message-date Daily grain and empty-window semantics;
- Coverage partial/finalize behavior and Lark failure;
- Report/Lark gate combinations;
- D1 batching above 500 Conversations;
- `first_seen_at` preservation and immutable identity conflict;
- explicit removed Conversation-Label state.

Aligned head `efc9fc8b801fbd2272aee15e20f075af6391c77e` is running final Branch Verification
`#603` against current `main`. This document must be updated with the exact successful final head/run
before Integration Review is closed.

## Remote actions not performed

- no Customer Chatwoot token or Provider request;
- no Worker deployment;
- no numbered or Remote D1 migration;
- no Remote D1 Business mutation;
- no Remote Lark schema or record mutation;
- no Queue send, retry or DLQ action;
- no Cron/Schedule or Webhook activation;
- no Cloudflare or Production secret change;
- no Customer/Production LIVE UAT;
- no Merge of PR `#68` into `main`.

## Integration follow-up after PASS

After final review only, a separately authorized Integration task must:

1. refresh `main`, open PRs and Migration sequence;
2. allocate and review the next additive Chatwoot Migration;
3. approve/apply D1 and Lark schema separately with backup/read-back evidence;
4. add exact non-secret Customer Account/Inbox mappings and Secret provisioning;
5. wire the existing Worker Reliability/lock/generation/Queue/DLQ boundary behind all false flags;
6. deploy flags-false only under explicit approval;
7. perform read-only exact identity/permission preflight;
8. run bounded state-only, exact rerun, late update, label removal, rate-limit, lock-loss, partial-sink
   and Coverage validation;
9. run an approved full-snapshot Daily/Report validation separately;
10. keep Schedule/Webhook disabled until Customer LIVE UAT, reconciliation and rollback gates pass.

PR `#68` remains Draft and must not merge itself.
