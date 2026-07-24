# Customer Connection and Google OAuth Contract v1

> Historical foundation contract. The current Connect invitation/start lifecycle
> is superseded by `docs/customer-connection-oauth-contract-v2.md`; provider,
> encryption and connector isolation rules not replaced there remain in force.

## Status

```text
PROGRAM                  = MULTI_CONNECTOR_CUSTOMER_CONNECTION_FOUNDATION
CONTRACT_VERSION         = customer-connection-oauth-v1
TARGET                   = Integration Workspace
RUNTIME                  = development / integration_workspace
PR_A                     = Shared foundation
PR_B                     = Google Ads OAuth
PR_C                     = YouTube OAuth
REMOTE_ACTION            = NOT_AUTHORIZED
BUSINESS_SYNC            = PROHIBITED
QUEUE_MESSAGE            = 0
LARK_WRITE               = 0
SCHEDULE                 = DISABLED
PRODUCTION               = BLOCKED
```

Google Ads และ YouTube ใช้ transport/crypto/token lifecycle ร่วมกันได้ แต่ต้องมี Connector key, Consent scope, Connection record, revoke/disconnect และ failure state แยกกัน.

## Security invariants

- Signed URL contains no signing/encryption/client Secret or Token.
- Invitation and OAuth state use HMAC-SHA-256, explicit version and canonical serialization.
- Every invitation/state has a cryptographic nonce, expiry and atomic one-time consume.
- OAuth state binds connector, customer, connection attempt, invitation, redirect URI, issued/expiry and nonce.
- Refresh Token uses AES-256-GCM with a random 96-bit IV, key version and authenticated context.
- Master key and signing keys are Worker Secrets; ciphertext/IV/key version live in D1.
- Decryption failure and unknown key version fail closed. Plaintext fallback is prohibited.
- Access Token is memory-only with a bounded expiry cache and never persists in D1/Queue/Lark/logs.
- Dynamic customer Refresh Token never uses `.dev.vars`; the environment adapter exists only for legacy DEV compatibility.
- Callback consumes state before code exchange and never retries the authorization code automatically.
- Callback never enqueues Business work and never writes Marketing/Lark facts.

## Connector keys and scopes

| Connector | Provider | Scope |
| --- | --- | --- |
| `google_ads` | `google` | `https://www.googleapis.com/auth/adwords` |
| `youtube` | `google` | `https://www.googleapis.com/auth/youtube.readonly` |
| `youtube` | `google` | `https://www.googleapis.com/auth/yt-analytics.readonly` |

No combined Google Ads + YouTube consent is allowed in v1.

## Connection metadata

The existing D1 `connections` table remains authoritative. Physical `id` is exposed only as application `connection_id`.

Additive fields:

```text
customer_key
connector_key
provider
external_account_id
external_account_name
credential_reference
granted_scopes_json
token_type
last_refresh_at
last_validated_at
connection_status
access_status
last_error_code
disconnected_at
provider_metadata_json
```

Legacy `encrypted_access_token` and `encrypted_refresh_token` columns remain for migration compatibility but the new repositories must never write them.

Allowed `connection_status`:

```text
not_configured
authorization_pending
connected
connected_access_pending
identity_selection_required
identity_mismatch
scope_insufficient
token_refresh_failed
revoked
disconnected
```

`access_status` is connector-specific and non-secret, for example:

```text
not_validated
validated
google_ads_api_access_pending
identity_selection_required
identity_mismatch
scope_insufficient
revoked
```

## `connection_invitations`

Grain: one Operator-created Connect invitation.

```text
invitation_id TEXT PRIMARY KEY
connector_key TEXT NOT NULL
customer_key TEXT NOT NULL
environment TEXT NOT NULL
nonce_hash TEXT NOT NULL UNIQUE
redirect_uri TEXT NOT NULL
issued_at INTEGER NOT NULL
expires_at INTEGER NOT NULL
consumed_at INTEGER
connection_id TEXT
created_at INTEGER NOT NULL
```

Atomic consume requires matching invitation, connector, customer and nonce hash with `consumed_at IS NULL` and `expires_at >= now`.

## `oauth_state_attempts`

Grain: one authorization-code attempt.

```text
attempt_id TEXT PRIMARY KEY
invitation_id TEXT NOT NULL
connection_id TEXT NOT NULL
connector_key TEXT NOT NULL
customer_key TEXT NOT NULL
redirect_uri TEXT NOT NULL
nonce_hash TEXT NOT NULL UNIQUE
pkce_credential_reference TEXT
issued_at INTEGER NOT NULL
expires_at INTEGER NOT NULL
consumed_at INTEGER
callback_error_code TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

State replay, connector/customer mismatch, redirect mismatch and expiry are Permanent failures.

## `encrypted_credentials`

Grain: one versioned encrypted Secret blob.

```text
credential_reference TEXT PRIMARY KEY
connection_id TEXT NOT NULL
credential_kind TEXT NOT NULL
ciphertext TEXT NOT NULL
iv TEXT NOT NULL
algorithm TEXT NOT NULL
key_version TEXT NOT NULL
status TEXT NOT NULL
replaced_by TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
revoked_at INTEGER
```

Allowed kinds v1:

```text
refresh_token
pkce_verifier
```

Replacement writes a new row, marks the previous row `replaced` and updates `connections.credential_reference` atomically. Disconnect/revoke marks the active credential revoked; ciphertext is retained until a separately approved retention cleanup.

## `connection_identity_selections`

Grain: one signed, expiring and one-time YouTube channel-selection attempt.

The row stores the approved candidate set as bounded JSON, nonce hash, Connection/customer binding, expiry, consumed time and selected external ID. The signed browser token does not trust an unsigned Channel ID; consume succeeds only when the selected ID exists in the persisted candidate set.

## Invitation contract

Default TTL: 24 hours. Configurable within a bounded range.

Signed payload:

```json
{
  "v": 1,
  "invitationId": "...",
  "connectorKey": "google_ads|youtube",
  "customerKey": "...",
  "environment": "development",
  "redirectUri": "https://...",
  "issuedAt": 0,
  "expiresAt": 0,
  "nonce": "..."
}
```

Operator output:

```text
connector
customerKey
connectUrl
expiresAt
environment
```

## OAuth state contract

Default TTL: 10 minutes. Configurable within a bounded range.

Signed payload:

```json
{
  "v": 1,
  "connectorKey": "google_ads|youtube",
  "customerKey": "...",
  "attemptId": "...",
  "connectionId": "...",
  "redirectUri": "https://...",
  "issuedAt": 0,
  "expiresAt": 0,
  "nonce": "...",
  "invitationId": "..."
}
```

PKCE uses S256 when the Google authorization/token endpoints accept the server-side code verifier contract. Signed state remains mandatory.

## HTTP route contract

```text
GET  /health
POST /operator/connection-invitations
GET  /connect/google-ads
GET  /oauth/google-ads/callback
GET  /connect/youtube
GET  /oauth/youtube/callback
POST /oauth/youtube/select-channel
```

Known path with unsupported method returns 405 plus `Allow`. Unknown path returns 404. No debug/token endpoint exists.

## OAuth callback outcomes

Browser/Operator results contain only:

```text
connector
connection_id
masked or approved external identity
connection_status
access_status
granted_scopes
validated_at
next_action
```

Token, code, state, nonce, signing key, encryption key, client Secret and raw Provider error payload are prohibited.

## Google Ads identity

- Exact advertiser and manager mapping comes from approved non-secret runtime configuration.
- OAuth success and encrypted Refresh Token persistence are independent from Developer Token access.
- If the Developer Token cannot read the Production advertiser, retain the credential and set:

```text
connection_status = connected
access_status = google_ads_api_access_pending
```

- Do not claim `LIVE_ACCESS` until exact advertiser visibility and manager relationship pass through the API.
- Manager Script remains the fallback data path; signed delivery PR #17 remains Draft/HOLD.

## YouTube identity

- Reuse the existing YouTube Data/Analytics clients and refresh-token provider.
- Call `channels.list` with `mine=true`.
- Zero channels: `identity_mismatch`.
- One channel: validate and bind.
- More than one channel: `identity_selection_required`; issue signed one-time selection state.
- Never choose the first result automatically and never auto-import a future channel.
- Persist selected `channel_id`, title, uploads playlist ID and subscriber-count-hidden metadata without Token material.

## Rollout boundary

Source implementation and tests do not authorize remote changes. Required sequence after explicit approval:

1. Backup Remote D1.
2. Apply additive migration.
3. Configure Worker Secrets and Google Redirect URIs.
4. Deploy with all Business schedules false.
5. Smoke test route/method allowlist without customer authorization.
6. Generate one Google Ads invitation and one YouTube invitation.
7. Wait for customer action.
8. Inspect redacted Connection results only.

Rollback disables public connection routes, restores the prior Worker version and preserves encrypted credential/audit rows for controlled follow-up. No automatic deletion is allowed.
