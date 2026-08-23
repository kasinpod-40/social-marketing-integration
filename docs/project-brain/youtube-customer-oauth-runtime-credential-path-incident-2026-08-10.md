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

## Customer-owner consent and Analytics value-contract incident — 2026-08-12

The actual customer Channel owner completed a fresh consent successfully. Remote D1 readback confirmed the
exact configured Channel suffix, `connected/validated`, both approved scopes, one new active encrypted Refresh
Token and the prior Refresh Token marked `replaced`. No OAuth callback Queue or Lark write occurred.

One fresh controlled Analytics catch-up for `2026-08-04..2026-08-10` passed the encrypted Customer Connection,
Refresh Token and Channel-owner gates, then stopped fail-closed before Business writes with:

```text
sync_run_id          bf9f39ef-fe9a-47ce-ab0e-25c2811013cf
work_key             youtube:f54a3b902951abbf42baad950f74a2c8
status               failed / terminal
error                 averageViewPercentage must be between 0 and 100
records_written       0
```

The Provider returned a valid non-negative `averageViewPercentage` above 100. Rewatching can make average
watched duration exceed the source video's duration, so the metric is not a bounded probability. Repository
validation and the blueprint incorrectly imposed a `0..100` ceiling. The correction preserves the exact
finite non-negative Source value, continues rejecting negative/non-finite values and does not clamp or
fabricate data. The failed operation is retained and must not be replayed; post-deploy validation uses a fresh
Queue delivery and requires completed D1/Lark reconciliation before Live closure.

The repository correction is gated before deployment: focused YouTube adapter/workbook parity `8/8`, full
unit `3007/3007`, Workers runtime `18/18`, report reliability `105/105`, architecture/hygiene, dependency
audit with zero vulnerabilities, clean deploy dry-run and diff check all pass. Live status remains pending
until a reviewed deployment and a different fresh operation complete reconciliation.

### Second post-deploy value-contract incident

PR #637 merged and the reviewed Integration Worker version
`c56c255f-2ca0-42be-ad2b-552d9b4f0fe5` served 100% traffic. One new catch-up using the same bounded range
and a new operation identity passed Owner OAuth, exact Channel authorization and both 100-video inventory
phases. It then stopped before staging any Analytics row:

```text
sync_run_id          30383548-d570-4fac-acfb-5c92f5ea9b7d
work_key             youtube:b9268e5ac108b031033727c0ecceb9e3
status               failed / terminal
error                 likes must be a non-negative safe integer
records_written       0
new exact alerts      2 retained open
```

The RAW adapter had reused the cumulative Data API non-negative-count rule for period Analytics columns.
That conflated two distinct Source contracts and rejected a signed daily Provider adjustment. The scoped
correction accepts signed safe integers for Analytics `views`, `likes`, `comments` and `shares`, still
rejects fractional/non-finite/unsafe values, and leaves cumulative Channel/Video counts non-negative.
No value is rounded, clamped or fabricated. This second failed Work is also immutable evidence and must not
be replayed; closure requires reviewed merge/deploy plus exactly one new catch-up and D1/Lark reconciliation.

## Live closure after PR #638 — 2026-08-12

PR #638 merged to `main` at `61cd05afa0f0f1c402c206242c074296c9b47f86`; exact-head CI passed.
Reviewed Integration Worker version `0aff7439-5ea2-4df3-8926-1b7430c98659` was deployed and read back as
the only version receiving 100% traffic. Preflight found exactly one `connected/validated` customer-owner
connection with both scopes and one active encrypted Refresh Token, plus zero active YouTube Work/locks.

Exactly one fresh Queue delivery was sent for requested range `2026-08-04..2026-08-10`. It did not replay
either retained failure. Work `youtube:51b03da1705e0412a038e5dc51016c31` completed and sync run
`4ff26ea0-6a83-4781-95f1-ca0fe609a0e1` succeeded with 837 selected/queried Videos, zero failed Videos,
1,919 Analytics rows, zero missing reconciliation rows, 2,079 writes and zero new YouTube alerts.

D1 completion/checkpoint committed to the fresh run with reconciliation not required. GET-only Lark
readback verified 1,919 rows and 1,919 unique stable keys, with zero duplicates, zero Channel mismatch and
zero invalid count values. Thirteen signed count cells were preserved exactly, proving the corrected Source
contract on Live data. Provider rows covered `2026-08-04..2026-08-09` within the requested window; no row
was fabricated for the day without Source data.

```text
REPOSITORY_IMPLEMENTATION = FIXED_MERGED_PR_638
REMOTE_DEPLOYMENT         = PASS_100_PERCENT
LIVE_OWNER_PREFLIGHT      = PASS
LIVE_ANALYTICS_CATCH_UP   = PASS_FRESH_OPERATION
D1_LARK_RECONCILIATION    = PASS
CUSTOMER_RECONNECT        = COMPLETE_NO_DAILY_ACTION_REQUIRED
FAILED_WORK_REPLAY        = PROHIBITED_NOT_RUN
PRODUCTION                = BLOCKED
```

## Customer Production credential cutover — 2026-08-23

Customer Production D1 retains the exact connected/validated YouTube Connection and active encrypted Refresh
Token that passed the Live closure above. A migrated ciphertext cannot be decrypted by a different Customer
Worker key, while Cloudflare correctly prevents reading the Integration Worker Secret value. This is a key
ownership boundary, not a missing OAuth grant and not a reason to request customer consent again.

The reviewed cutover contract therefore rewraps the same plaintext only inside the Integration Worker:

1. the exact active v1 envelope is decrypted with the existing Integration Secret;
2. the Refresh Token is immediately encrypted under a new Customer-owned v2 AES-256-GCM Secret;
3. only the new encrypted envelope/reference is moved to Customer D1;
4. Customer Production performs Owner identity/refresh proof before schedule activation;
5. legacy `YOUTUBE_OAUTH_*` credentials remain prohibited as Analytics fallback.

The operator boundary is disabled by default, authenticated, restricted to the canonical Integration profile,
requires exact connection/reference/source/target/confirmation values, and returns no plaintext, ciphertext or
key material. Customer Production runtime admission reuses the canonical reviewed ownership predicate and
rejects historical aliases and mixed tuples. Live rewrap/deploy/schedule completion remains pending reviewed
merge and external readback.
