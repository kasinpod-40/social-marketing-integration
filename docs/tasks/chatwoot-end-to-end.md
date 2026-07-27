# Chatwoot End-to-End Integration

## Final Integration Review status

```text
TASK_STATUS                      = PASS_FOR_INTEGRATION_REVIEW
WORKSTREAM                        = CHATWOOT_END_TO_END
DRAFT_PR                          = #68
BRANCH                            = agent/chatwoot-end-to-end
INITIAL_BASE_SHA                  = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
REMEDIATION_HEAD                  = c6812dd92c5f6963204b69f294348a6156e092c5
FINAL_REVIEW_MAIN_SHA             = 4c9334a69ced8b595fa433b780a77452eb7cd940
ALIGNMENT_PRS                     = #90, #91
FINAL_ALIGNED_CODE_HEAD           = ae2b5472b77cd12e652fe3b70082fc88d3731d46
BRANCH_BEHIND_MAIN_AT_REVIEW      = 0
LATEST_MIGRATION_OBSERVED         = 0016_tiktok_post_lark_pipeline.sql
CHATWOOT_MIGRATION                = NOT_CREATED / INTEGRATION_RESERVED
RUNTIME_WIRING                    = NOT_PERFORMED
REMOTE_D1                         = NOT_TOUCHED
REMOTE_LARK                       = NOT_TOUCHED
QUEUE_OR_DLQ_ACTION               = NONE
DEPLOYMENT                        = NONE
SCHEDULE                          = DISABLED
WEBHOOK                           = DISABLED / UNSUPPORTED
CUSTOMER_OR_PRODUCTION_LIVE_UAT   = NOT_PERFORMED
PR_68_MERGE                       = NOT_PERFORMED
```

Alignment PRs `#90` and `#91` merged current `main` into the Chatwoot feature branch only. They did
not merge PR `#68` into `main` and performed no Provider, Remote or runtime action.

## Objective and scope

PR `#68` adds a bounded Chatwoot Application API polling foundation for:

- PII-minimized current state and immutable analytics facts;
- deterministic Stable keys, Source revisions and idempotent reruns;
- sink-aware Coverage evidence;
- optional Lark state writes through the existing `TableSyncEngine`;
- separately gated Daily/Report facts from an explicitly approved full snapshot.

Runtime routing, numbered Migration allocation, shared table registry, customer mapping, Secrets,
Deployment, Queue/DLQ execution, Schedule/Webhook activation and LIVE UAT remain separate Integration
tasks.

## Shared contracts reused

- shared Permanent/Transient runtime errors;
- shared stable fingerprint helper;
- existing incremental checkpoint contract;
- existing Coverage run/entity contracts and storage;
- existing `TableSyncEngine.planByKey()` / `executePlan()`;
- existing Chatwoot Connector, Job and Source foundation;
- future existing Reliability runner, distributed lock, generation fence, Queue retry and DLQ boundary.

No parallel Reliability engine, Queue framework, generic D1 writer, Lark engine or Report engine was
introduced.

## Remediation of the original review blockers

The original Draft received `CHANGES_REQUIRED / NOT_PASS_FOR_INTEGRATION`. The following corrections
are now implemented and regression-tested.

### Message history

- Initial Message response is treated as Chatwoot's latest bounded page, not complete history.
- Earlier history is collected using strictly decreasing `before` cursors.
- Forward `after` remains supported by the client but is not used as an unproven initial baseline.
- Duplicate, repeated, non-decreasing and out-of-range cursors fail Permanently.
- Per-conversation page and row limits remain bounded and fail closed.

### HTTP and retry behavior

- HTTP status is classified before strict success-body JSON parsing.
- `408`, `425`, `429`, `500`, `502`, `503`, `504` remain Retryable even with empty, HTML or other
  non-JSON error bodies.
- Successful malformed JSON remains a Permanent Source-contract error.

### Reporting metrics

- Selected Conversations read their own Reporting Events.
- Historical first-response, resolution and reply evidence is not dropped merely because it falls
  outside the incremental overlap.
- Account Reporting Event transport retains bounded `since` and `until` support for future approved
  range reads.

### Daily metric grain

- Message counts use Message creation date.
- Response, Resolution and Reply metrics use Reporting Event end date.
- New Conversation uses Conversation creation date.
- Reopen uses the confirmed newer transition revision date.
- Conversation update time does not move cumulative Message counts into a later date.
- Empty input creates no invented zero Account Daily row.
- Unsupported historical snapshot values remain `null`, not zero.
- Daily rows remain `partial` until a separately approved complete historical assignment/status event
  contract exists.
- Report/Daily writes require `fullSnapshot=true`.

### Execution gates

```text
Connector gate        explicit before Provider reads
D1 gate                explicit before durable state/facts
Checkpoint gate        explicit before admission
Lark gate              independent and optional
Report gate            independent and requires full snapshot
Webhook gate           unsupported and fails closed
Schedule               not wired
```

Report disabled removes all Daily datasets from D1 and Lark writes. Lark disabled requires no Lark
repository, engine or table mapping.

### D1 scale and identity

- Conversation State and Conversation Label reads are batched at no more than 500 IDs.
- Regression covers 501 selected Conversations.
- `first_seen_at` and `created_at` are preserved on rerun.
- Updates remain Source-revision gated.
- Immutable identity conflicts fail Permanently as `CHATWOOT_IMMUTABLE_IDENTITY_CONFLICT`.
- Stale revisions with matching identity remain idempotent skips.
- Reopen count increments only on a strictly newer `resolved -> non-resolved` revision.

### Coverage order

```text
partial Coverage
→ required D1 writes
→ optional required Lark writes
→ Coverage entities
→ complete Coverage
→ checkpoint
```

D1 or Lark failure leaves Partial Coverage and cannot advance the checkpoint.

### PII minimization

Never persisted:

- Contact/Agent name, email, phone, identifier, address, avatar or IP;
- Message body, processed content, transcript, quote or search text;
- Attachment URL, filename, thumbnail, coordinates, transcription or nested metadata;
- unrestricted custom/additional attributes;
- credentials, authorization header, website token, callback URL or raw request/response body;
- raw Chatwoot Label title.

Label association uses opaque Label ID. Normalized Label title exists transiently only to calculate a
stable `title_hash`.

## Source and pagination contract

```text
GET /api/v1/accounts/{account_id}/inboxes
GET /api/v1/accounts/{account_id}/agents
GET /api/v1/accounts/{account_id}/teams
GET /api/v1/accounts/{account_id}/labels
GET /api/v1/accounts/{account_id}/contacts?page={n}&sort=-last_activity_at
GET /api/v1/accounts/{account_id}/conversations?page={n}&status=all&assignee_type=all
GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?before={id}
GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages?after={id}
GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/labels
GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/reporting_events
GET /api/v1/accounts/{account_id}/reporting_events?page={n}&since={s}&until={s}
```

`api_access_token` is sent only in the request header. Exact identity is
`(base_url, external_account_id) -> customer_key/account_key`.

```text
cursor_key          = chatwoot:{account_key}:analytics
default overlap     = 48 hours
incremental scope   = bounded newest Conversation and resolved-Contact pages
full snapshot       = explicit approved mode only
Message baseline    = bounded backward history per selected Conversation
missing page row    = not deletion evidence
```

Source-record hashes exclude observation/seen timestamps so unchanged Source data keeps the same hash
across reruns.

## Proposed additive Data Model

No numbered Migration was created in PR `#68`.

```text
chatwoot_account_state
chatwoot_inbox_state
chatwoot_contact_state                  # resolved-Contact observations only
chatwoot_agent_state
chatwoot_team_state
chatwoot_label_state                    # title_hash; no raw title
chatwoot_conversation_state
chatwoot_conversation_label_state       # active and explicit removed state
chatwoot_message_analytics_state        # no Message content
chatwoot_reporting_event_facts
chatwoot_conversation_daily_facts       # optional full-snapshot report
chatwoot_agent_daily_facts              # optional full-snapshot report
chatwoot_inbox_daily_facts              # optional full-snapshot report
chatwoot_account_daily_facts            # optional full-snapshot report
```

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

The Contacts endpoint is explicitly represented as `resolved_contacts` / `exact_entities`, never as
proven complete all-Contact inventory.

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

No shared table registry or Remote Lark Base was changed.

## Proposed default-false flags

```env
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Storage and Report flags never enable Connector or Schedule implicitly.

## Files changed in Draft PR #68

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

No reserved shared file was modified.

## Verification evidence

```text
Remediation head c6812dd...       Branch Verification #598 PASS
Aligned head efc9fc8...           Branch Verification #603 PASS
Documentation head c2a26cc...     Branch Verification #606 PASS
Closeout head c465737...          Branch Verification #607 PASS
Latest aligned head ae2b547...    Branch Verification #608 PASS
```

Latest aligned verification gates:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok regression     PASS
Full Node Unit / Integration         PASS
Workers runtime                       9 / 9 PASS
Report reliability                   91 / 91 PASS
Dependency audit                     0 vulnerabilities
Wrangler deploy dry-run              PASS / no deployment
Diagnostics upload                   PASS
```

The resulting documentation-only head must retain a successful PR Branch Verification check. The
exact-head PR check is the authority and does not require another content-only status commit.

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
- no Merge of Draft PR `#68` into `main`.

## Integration follow-up

A later explicitly authorized Integration task must:

1. refresh `main`, open PRs and Migration sequence;
2. allocate and review the next additive Chatwoot Migration;
3. approve/apply D1 and Lark schema separately with backup and read-back evidence;
4. add exact non-secret Customer Account/Inbox mappings and provision Secrets;
5. wire existing Worker Reliability/lock/generation/Queue/DLQ contracts behind all false flags;
6. deploy flags-false only under explicit approval;
7. perform read-only exact identity and permission preflight;
8. validate bounded state-only sync, exact rerun, late update, Label removal, rate limit, lock loss,
   partial sink and Coverage;
9. validate an approved full-snapshot Daily/Report run separately;
10. keep Schedule/Webhook disabled until Customer LIVE UAT, reconciliation and rollback gates pass.

**Decision: `PASS_FOR_INTEGRATION_REVIEW`. PR `#68` remains Draft and unmerged.**
