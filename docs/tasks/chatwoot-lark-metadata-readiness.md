# Chatwoot Lark Metadata and Mapping Readiness

## Status

```text
TASK_STATUS                    = IMPLEMENTED_PENDING_CI
SCOPE                          = REPOSITORY_ONLY
CONTRACT_VERSION               = chatwoot-lark-metadata-readiness-v1
ENVIRONMENT                    = development
CUSTOMER_PROFILE               = integration_workspace
CUSTOMER_KEY                   = chemistry_k
CHATWOOT_PROVIDER_ADMIN        = STILL_PENDING
REMOTE_LARK_REQUEST            = NOT_RUN_DURING_IMPLEMENTATION
REMOTE_MUTATION                = NONE
PRODUCTION                     = BLOCKED
```

## Objective

Prepare one authoritative, PII-minimized Chatwoot-to-Lark mapping contract and a guarded metadata-only
preflight while the Chatwoot Integration User remains an `agent` and Account Reporting Events stays
blocked pending promotion to `administrator`.

This task does not bypass the Provider permission gate. It completes only the Repository-side Lark
readiness work that can proceed independently.

## Source authority

The mapping is derived from current executable contracts rather than guessed from historical documents:

1. `CHATWOOT_LARK_WRITE_TARGETS` in `prepare-chatwoot-analytics-sync.js` defines the exact 15 Lark sinks
   and Stable-key fields.
2. The actual PII-minimized Lark write sets define every Field written to each sink.
3. Migration `0018_chatwoot_analytics.sql` remains the D1 storage authority, but Lark mapping follows the
   write-set projection where the contracts intentionally differ. For example, Lark receives
   `reopen_count_delta`; the D1 Conversation state stores accumulated `reopen_count`.
4. Existing `LARK_TABLE_ENV` mappings remain authoritative for non-secret Table IDs.

## Fifteen target tables

```text
RAW_Chatwoot_Accounts
RAW_Chatwoot_Inboxes
RAW_Chatwoot_Contacts
RAW_Chatwoot_Agents
RAW_Chatwoot_Teams
RAW_Chatwoot_Labels
RAW_Chatwoot_Conversations
RAW_Chatwoot_Conversation_Labels
RAW_Chatwoot_Message_Analytics
RAW_Chatwoot_Reporting_Events
MKT_Conversations
MKT_Conversation_Daily
MKT_Agent_Daily
MKT_Inbox_Daily
MKT_Conversation_Account_Daily
```

The Blueprint records Field order, preferred Lark type, compatible existing transport types, required and
nullable semantics, Stable-key role, Source path, business semantics and import notes.

## Type and compatibility contract

```text
Text          = 1
Number        = 2
SingleSelect  = 3
DateTime      = 5
Checkbox      = 7
```

Compatibility is intentionally additive-safe:

- Boolean fields prefer Checkbox and accept existing Number `0/1` transport.
- Enum/status fields prefer SingleSelect and accept existing Text.
- Timestamps prefer DateTime and accept existing epoch Number.
- Stable keys, hashes, revisions and metric dates remain Text.
- Counts and duration seconds require Number.

An incompatible type or a missing/non-primary Stable-key Field is blocked. The operator never plans a
Field-type mutation.

## Operator behavior

Plan-only default:

```bash
node scripts/chatwoot-lark-metadata-readiness.mjs
```

Separately confirmed metadata-only read after merge:

```bash
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_CHATWOOT_LARK_METADATA=READ_ONLY_CHATWOOT_LARK_METADATA \
  node scripts/chatwoot-lark-metadata-readiness.mjs --phase=lark-preflight --execute
```

The executable phase requires a clean current `main` matching `origin/main`. It lists Tables and Fields
only. It does not read Lark records.

Sanitized evidence is stored under the ignored path:

```text
outputs/chatwoot-lark-metadata-readiness/summary.json
```

Raw Table IDs, credential values and raw metadata payloads are not persisted.

## Decisions

```text
PASS_CHATWOOT_LARK_METADATA_READY
CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED
CHATWOOT_LARK_TYPE_MISMATCH_BLOCKED
CHATWOOT_LARK_TABLE_AMBIGUOUS_BLOCKED
```

An additive plan can contain only:

```text
bind_table_env
create_table
create_field
```

It can never contain Table/Field deletion, rename or Field-type mutation. Applying an additive plan is a
separate explicitly reviewed Lark mutation phase and is not implemented or authorized here.

## Safety boundary

```text
Chatwoot Provider requests          = 0
Chatwoot token access               = 0
Lark record reads                   = 0
Lark mutations                      = 0
Remote D1 query/write/migration     = 0
Queue/DLQ actions                   = 0
Worker deployment                   = 0
Schedule/Webhook activation         = 0
Secret changes                      = 0
Production actions                  = 0
```

`docs/current-task.md` remains owned by the active cross-workstream rollout and is intentionally not
modified by this isolated Chatwoot readiness task.

## Remaining gates

1. Promote Chatwoot Profile ID `14` from `agent` to `administrator`.
2. Rerun the merged Chatwoot Provider GET-only preflight until `accepted=true`.
3. Run this Lark metadata-only preflight from clean current `main`.
4. Review any additive Lark schema plan separately.
5. Only after Provider and Lark readiness both pass may an all-flags-false Runtime wiring phase be opened.
