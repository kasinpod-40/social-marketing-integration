# YouTube Customer OAuth Runtime Credential-path Incident — 2026-08-10

## Incident

Customer YouTube OAuth consent had already completed and the D1 Connection retained a matching active
encrypted Refresh Token reference. The ingestion runtime nevertheless constructed its Owner Analytics
client from the legacy `YOUTUBE_OAUTH_*` Worker Secret path. Consequently an identity mismatch from that
legacy credential was incorrectly described as a customer OAuth owner/channel problem.

The earlier operational conclusion that no customer action would ever be required was also premature.
Stored D1 consistency did not prove that Google would still accept the retained Refresh Token.

## Sanitized evidence

```text
connection_status                  connected
access_status                      validated
connection credential reference   present
matching active refresh reference present
recorded connection error         none
failed owner run                   YOUTUBE_CHANNEL_IDENTITY_MISMATCH
later successful public runs      analytics not_enabled / zero Analytics rows
```

The connection record proves stored credential consistency, not a fresh Provider refresh. The reviewed
post-deployment refresh later returned `invalid_grant`, so the retained grant cannot be reused.

Two developer accounts completed code exchange and approved scopes, but the callback received no Channel
identity and closed each attempt fail-closed as `identity_mismatch`, with zero Queue/Lark writes. They are
not substitutes for the customer Channel owner and must not be tried again.

## Confirmed repository cause

`packages/connectors/src/youtube/youtube-runtime-factory.js` reads a static access token or the
`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` and `YOUTUBE_OAUTH_REFRESH_TOKEN` tuple.
The active YouTube route passed that client directly into Owner identity and Analytics work. The merged
Customer OAuth callback path stores encrypted credentials through `connections.credential_reference` and
`encrypted_credentials`, but ingestion had no bridge from those tables to the Owner client.

This violated the Customer OAuth v1 invariant that dynamic customer Refresh Tokens use the encrypted
repository while environment credentials remain legacy DEV compatibility only.

## Correction contract

1. Reuse the existing D1 Customer Connection and encrypted credential repository.
2. Require exact `youtube`, customer, `connected/validated`, both approved scopes, active credential
   equality and configured Channel identity before constructing the Owner client.
3. Reuse `GoogleRefreshTokenAccessProvider`; Access Tokens stay memory-only and bounded-cache.
4. Keep API-key Public YouTube access separate.
5. When Analytics is enabled, prohibit fallback to legacy static YouTube OAuth environment credentials.
6. Preserve operator dry-run/Lark-UAT public-only behavior and every existing storage/retry/reconciliation
   contract.
7. Do not mark Live fixed until a reviewed deployment, read-only Owner preflight and controlled Analytics
   catch-up/reconciliation pass.

## Closure state

```text
REPOSITORY_IMPLEMENTATION = FIXED_AND_GATED
REMOTE_DEPLOYMENT         = PASS
LIVE_OWNER_PREFLIGHT      = BLOCKED_INVALID_GRANT
LIVE_ANALYTICS_CATCH_UP   = NOT_RUN
CUSTOMER_RECONNECT        = REQUIRED_ONCE_BY_ACTUAL_CHANNEL_OWNER
```

## Implemented correction

- Both active YouTube job routes now use one Worker-owned runtime client factory.
- Analytics-enabled work reads the exact Customer Connection and active encrypted credential reference
  from D1, then uses the shared Google refresh provider to obtain a memory-only Access Token.
- Authorization fails closed before a Provider request when customer, connector, state, scopes, credential
  reference or configured Channel does not match.
- Static `YOUTUBE_OAUTH_*` credentials are not an Owner Analytics fallback on these routes. Public/API-key
  reads and operator public-only dry-runs remain separate.
- Focused regression, full unit, Workers runtime `18/18`, report reliability `105/105`, architecture and
  repository hygiene, dependency audit with zero vulnerabilities, deploy dry-run and diff check passed.

This closes the repository defect but does not claim a Live Analytics fix. OAuth app publishing does not
revive an invalid/revoked Refresh Token. The customer must use a fresh Connect link and consent once with
the Google account or Brand Account that actually owns the configured Channel. The resulting Refresh Token
can then be reused without daily customer action until Google or the user revokes/expires it. Read-only Owner
preflight, controlled Analytics catch-up and D1/Lark reconciliation remain required after that one-time consent.
