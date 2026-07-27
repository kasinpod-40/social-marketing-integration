# Chatwoot Provider GET-only Preflight

## Status

```text
TASK_STATUS                    = IMPLEMENTED_PENDING_VERIFICATION
WORKSTREAM                     = CHATWOOT_PROVIDER_GET_ONLY_PREFLIGHT
ENVIRONMENT                    = development
CUSTOMER_PROFILE               = integration_workspace
CUSTOMER_KEY                   = chemistry_k
DEPLOYMENT_TYPE                = self_hosted
REMOTE_MUTATION                = NONE
PRODUCTION                     = BLOCKED
```

## Incident and verified partial result

The first bounded GET-only attempt validated the Chatwoot Profile, exact Account, Inboxes, Agents, Teams,
Labels, Contacts and Conversations, then received HTTP `401` only from Account Reporting Events.

This is not treated as proof that the Token is invalid. The durable operator classifies `401` or `403` from
`list_reporting_events` as:

```text
CHATWOOT_REPORTING_ADMIN_REQUIRED
```

The result preserves every earlier passed endpoint and returns an exact next action: promote the Integration
User to Chatwoot `Administrator`, then rerun the same command.

## Command

Plan only:

```bash
node scripts/chatwoot-provider-preflight.mjs
```

Execute GET-only validation:

```bash
CONFIRM_CHATWOOT_PROVIDER_GET_ONLY=RUN_CHATWOOT_PROVIDER_GET_ONLY \
  node scripts/chatwoot-provider-preflight.mjs --execute
```

Private ignored evidence:

```text
outputs/chatwoot-provider-preflight/summary.json
```

## Decision contract

```text
PASS_CHATWOOT_PROVIDER_GET_ONLY
  → exact identity and every required GET endpoint passed
  → next gate: chatwoot_lark_metadata_and_mapping_preflight

CHATWOOT_REPORTING_ADMIN_REQUIRED
  → identity and non-reporting endpoints passed
  → Reporting Events returned 401/403
  → next gate: chatwoot_integration_user_role_update
```

Unexpected authentication, transport, pagination, response-contract or target-identity failures remain hard
errors and are not downgraded to a permission blocker.

## Security and mutation boundary

- Token is read only from `.dev.vars` or the process Environment and sent only through `api_access_token`.
- Token, raw Base URL, raw Account ID, Profile name/email, Account name and Provider payloads are not written
  to evidence.
- Evidence contains only hashes, role, permissions count, endpoint status/counts and request counters.
- Provider transport is GET-only.
- Provider writes, D1 writes, Queue/DLQ actions, Lark reads/writes, Worker deployment, Schedule/Webhook activation
  and Production actions are absent.
- Migration `0018_chatwoot_analytics.sql` is already applied and must not be rerun by this task.

## Acceptance criteria

- Default invocation is plan-only and performs no Provider call.
- Execute mode requires the exact confirmation value.
- Environment/Profile/Customer/Base URL/Account/deployment type are fail-closed.
- Exact Account must appear once in `/api/v1/profile`.
- Reporting Events 401/403 produces a deterministic blocked result rather than a generic Token failure.
- Other endpoint authentication failures remain hard failures.
- Evidence contains no credential, PII or raw Provider payload.
- Focused tests, full Repository verification, dependency audit and Wrangler dry-run pass.
