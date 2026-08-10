# YouTube Customer OAuth Runtime Credential-path Incident — 2026-08-10

## Incident

Customer YouTube OAuth consent had already completed and the D1 Connection retained a matching active
encrypted Refresh Token reference. The ingestion runtime nevertheless constructed its Owner Analytics
client from the legacy `YOUTUBE_OAUTH_*` Worker Secret path. Consequently an identity mismatch from that
legacy credential was incorrectly described as a customer OAuth owner/channel problem.

The earlier operational recommendation to reconnect before fixing the runtime was incorrect. The repository
bridge is now merged and deployed. A reviewed live preflight subsequently proved that the stored refresh token
is rejected by Google with sanitized OAuth `invalid_grant`; one new consent is therefore required, but only
after the OAuth app readiness gate is verified so the replacement token is not predictably short-lived.

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

The connection record proves stored credential consistency, not token validity at the Provider. That distinction
is now confirmed by the post-deployment preflight.

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
REMOTE_DEPLOYMENT         = PASS_VERSION_25f835d9_81e3_4acb_b62e_a678fd4c90fc
LIVE_OWNER_PREFLIGHT      = FAILED_CLOSED_GOOGLE_OAUTH_INVALID_GRANT
LIVE_ANALYTICS_CATCH_UP   = NOT_SENT
CUSTOMER_RECONNECT        = REQUIRED_ONCE_AFTER_OAUTH_APP_READINESS
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

## Reviewed deployment and fail-closed live evidence

PR `#593` merged as `f07626f68f3d9f15a444250636fada0443b42047`. The Integration Workspace
deployed the matching tree as Worker version `25f835d9-81e3-4acb-b62e-a678fd4c90fc` at 100%; the
existing cron/Queue topology remained unchanged and Production, Notification runtime and DLQ redrive remained
blocked/off.

Two uniquely identified Owner preflight attempts were recorded:

- R1 (`sync_run_id=1b9b98c2-8893-43c3-ad33-45c9ca103c7a`) stopped at the generation fence with
  `YOUTUBE_METRIC_DATE_GENERATION_MISMATCH`; Provider reads and
  Business writes were zero. The controller date was corrected and the failed identity was not reused.
- R2 (`sync_run_id=c643b3f9-a603-4d45-b4d9-a4e098e69782`) reached the shared Google token refresh
  path and failed with `GOOGLE_OAUTH_TOKEN_REFRESH_REJECTED`;
  sanitized provider detail was HTTP 400 / OAuth `invalid_grant`. Provider data reads and Business writes
  were zero.

The Analytics catch-up for `2026-08-03..2026-08-09` was intentionally not sent. No automatic retry, Queue
resend, DLQ redrive, Production, Notification or schedule mutation followed the rejection.

After 2-Step Verification was enabled, the Google Cloud owner session passed. Readback confirmed project
`Social MKT Data Hub`, the exact OAuth client used by the prior customer consent, User type `External` and
Publishing status `Testing`. The requested `youtube.readonly` and `yt-analytics.readonly` scopes are present.
This confirms the 7-day Testing-token lifecycle as the cause consistent with the live `invalid_grant`; the
secondary signed-in session remains irrelevant because it lacks project permissions. Do not issue replacement
consent until the explicitly approved publishing change completes.

## Remaining closure sequence

1. ~~Enable 2-Step Verification for the Google Cloud project owner and inspect the exact OAuth app.~~ PASS.
2. Obtain action-time approval and publish the External OAuth app out of Testing.
3. Reconnect the exact customer/channel once and verify the new active encrypted credential reference.
4. Run one new Owner preflight identity; only after it passes, send one controlled Analytics catch-up.
5. Reconcile exact D1/Lark Analytics rows and then record `LIVE_FIXED=YES` in this incident.

The repository defect is fixed and deployed. The live incident is not closed until steps 1–5 pass.
