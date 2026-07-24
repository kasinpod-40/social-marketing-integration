# Customer Connection OAuth Contract v2 — Preview-safe bounded retry

## Status and scope

This contract supersedes the invitation-start semantics in
`docs/customer-connection-oauth-contract-v1.md`. Provider identity, encrypted
credential, callback, Queue/Lark isolation and connector-specific consent rules
from v1 remain unchanged.

```text
CONTRACT_VERSION              = 2
DEFAULT_INVITATION_TTL        = 24 hours
DEFAULT_OAUTH_STATE_TTL       = 10 minutes
DEFAULT_MAX_ATTEMPTS          = 3
ALLOWED_MAX_ATTEMPTS          = 1..5
GET_CONNECT_SIDE_EFFECTS      = none
OAUTH_BEGIN_METHOD            = POST with exact confirmation marker
QUEUE_LARK_SCHEDULE_EFFECTS   = prohibited
```

## Browser flow

```text
GET /connect/<connector>?invitation=<signed-v2-token>
→ verify signature, binding, expiry and persisted invitation
→ render no-store/no-referrer confirmation page
→ do not reserve an attempt, create PKCE, create state or redirect

POST /connect/<connector>?invitation=<signed-v2-token>
Content-Type: application/x-www-form-urlencoded
Body: confirm=connect
→ atomically reserve one bounded attempt
→ create/reuse the connector/customer Connection
→ create encrypted PKCE verifier and one-time OAuth state
→ return 303 to the provider authorization URL

successful validated callback
→ consume OAuth state
→ persist encrypted Refresh Token and validated metadata
→ permanently complete the invitation

provider/callback/refresh/identity failure
→ consume or record the failed state as applicable
→ release the active invitation attempt
→ allow another explicit POST while TTL and attempt budget remain
```

Opening, refreshing, link-previewing or scanning the GET URL must not consume an
attempt. `HEAD` and unsupported methods return `405` before runtime/flow work.
Only one active attempt may exist for an invitation. An active attempt becomes
retryable after its state expiry. A completed, expired or exhausted invitation
fails closed and cannot be reopened.

## Invitation v2 payload

Signed payload fields:

```text
v
invitationId
connectorKey
customerKey
environment
redirectUri
issuedAt
expiresAt
maxAttempts
nonce
```

Every field is checked against the persisted D1 row. The signed token is a bearer
artifact and must not be stored in Source, documentation or logs.

## D1 authority

Migration `0012_retry_safe_customer_connection.sql` extends
`connection_invitations` additively:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `attempt_count` | INTEGER | yes | Total successfully reserved OAuth starts |
| `max_attempts` | INTEGER | yes | Bounded limit, 1–5 |
| `active_attempt_id` | TEXT | no | Current reserved OAuth state attempt |
| `active_attempt_expires_at` | INTEGER | no | Retry lock expiry in epoch milliseconds |

Existing rows default to `max_attempts=1`; migration does not reopen consumed
invitations. New v2 invitations explicitly persist their signed attempt limit.

Reservation is one conditional D1 update that requires:

- exact invitation, connector, customer, nonce and max-attempt binding;
- `consumed_at IS NULL`;
- invitation and attempted OAuth state still within expiry;
- `attempt_count < max_attempts`;
- no unexpired active attempt.

Successful reservation increments `attempt_count` and writes the active attempt
atomically. Connection attachment, release and completion must match the same
invitation/attempt/connector/customer/connection binding.

## HTTP and security contract

- Confirmation POST accepts only
  `application/x-www-form-urlencoded`, at most 1 KiB, with exactly one field:
  `confirm=connect`.
- Successful OAuth begin returns `303 See Other`.
- Browser responses use `no-store`, `no-referrer`, `nosniff`,
  `frame-ancestors 'none'`, `form-action 'self'`, restrictive Permissions Policy
  and same-origin opener isolation.
- Confirmation HTML never reflects the signed invitation token.
- Exhausted attempts return `429`; active/inactive attempt conflicts return
  `409`; expired invitations return `410`.
- The callback still emits no Queue message, writes no Lark business record and
  activates no connector or schedule.

## Required verification

- repeated GET and scanner HEAD cause zero OAuth/D1 mutation;
- POST without the exact confirmation marker causes zero OAuth mutation;
- concurrent POSTs produce exactly one active reservation;
- abort/expiry and callback failure permit only a bounded retry;
- successful callback permanently closes the invitation;
- callback state remains signed, redirect-bound, PKCE-S256 and one-time;
- legacy consumed invitations stay closed after migration;
- Google Ads and YouTube provider regressions and Queue/Lark isolation pass;
- default repository, audit and deploy-dry-run gates pass before rollout.

## Rollout boundary

Local implementation does not authorize Remote D1 migration, deployment, Secret
rotation or link generation. Apply migration `0012`, deploy and generate new test
links only under the separately reviewed sequence in
`docs/customer-connection-oauth-rollout.md`.
