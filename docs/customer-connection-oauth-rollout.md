# Customer Connection OAuth — Guarded Rollout

## Current authority

```text
REMOTE_D1_MIGRATION             = 0011_0012_COMPLETE
WORKER_DEPLOYMENT               = V2_COMPLETE
SOURCE                          = V2_MERGED_PR_45
GOOGLE_REDIRECT_URI_LIVE_CHANGE = COMPLETE
CONNECT_LINK_GENERATION         = V2_CUSTOMER_LINKS_2_ACTIVE_7D
CUSTOMER_OAUTH                  = AWAITING_CUSTOMER_ACTION
SCHEDULES                       = DISABLED
QUEUE_MESSAGES                  = 0
LARK_WRITES                     = 0
```

Migration `0012` and Worker v2 rollout completed on `2026-07-24`. The short-lived
test links expired unused. On `2026-07-25`, the operator Secret was rotated
without persisting plaintext and one seven-day/three-attempt customer link per
connector was created. Final live version is
`79ef3710-2ed2-4373-b0d0-42ec76896fa6`. Links expire around
`2026-08-01 00:15 Asia/Bangkok`; signed URLs are not stored here. Provider
callback UAT remains pending. Use the real ignored `wrangler.sync.jsonc`; never
substitute the example file for remote commands.

## Routes

```text
POST /operator/connection-invitations
GET  /connect/google-ads
POST /connect/google-ads
GET  /oauth/google-ads/callback
GET  /connect/youtube
POST /connect/youtube
GET  /oauth/youtube/callback
POST /oauth/youtube/select-channel
```

Exact Google Cloud Authorized redirect URIs:

```text
https://<deployed-domain>/oauth/google-ads/callback
https://<deployed-domain>/oauth/youtube/callback
```

## Non-secret runtime mappings

```text
MKT_CONNECTION_PUBLIC_ORIGIN
MKT_CONNECTION_CUSTOMER_KEY
MKT_GOOGLE_ADS_REDIRECT_URI
MKT_YOUTUBE_REDIRECT_URI
GOOGLE_OAUTH_CLIENT_ID
MKT_CONNECTION_ENCRYPTION_KEY_VERSION
MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID
MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID
MKT_GOOGLE_ADS_API_VERSION
```

## Required Worker Secret names

```text
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_ADS_DEVELOPER_TOKEN
MKT_CONNECTION_OPERATOR_TOKEN
MKT_CONNECTION_INVITATION_SIGNING_KEY
MKT_CONNECTION_STATE_SIGNING_KEY
MKT_CONNECTION_SELECTION_SIGNING_KEY
MKT_CONNECTION_ENCRYPTION_KEY_V1
```

Never pass Secret values in shell arguments, source files, logs or chat. Set each interactively:

```bash
npx wrangler secret put <SECRET_NAME> --config wrangler.sync.jsonc
```

## Guarded v2 sequence after separate approval

Record the current Worker version, then export Remote D1 before migration:

```bash
npx wrangler versions list --config wrangler.sync.jsonc
npx wrangler d1 export social-mkt-state-dev --remote --config wrangler.sync.jsonc --output /tmp/social-mkt-state-dev-before-0012.sql
shasum -a 256 /tmp/social-mkt-state-dev-before-0012.sql
```

Verify that all Business schedule/connector/write flags in `wrangler.sync.jsonc` remain false, then apply the additive migration:

```bash
npx wrangler d1 migrations list social-mkt-state-dev --remote --config wrangler.sync.jsonc
npx wrangler d1 migrations apply social-mkt-state-dev --remote --config wrangler.sync.jsonc
```

Deploy only after Secrets and both exact Redirect URIs are configured:

```bash
npx wrangler deploy --config wrangler.sync.jsonc
```

Smoke without customer credentials. Verify an unknown route is `404`, operator
GET is `405`, and scanner `HEAD /connect/<connector>` is `405`. After separately
approved test-link generation, open the same GET URL repeatedly and verify it
stays on the confirmation page; only the explicit form POST may redirect:

```bash
curl -i https://<deployed-domain>/unknown
curl -i https://<deployed-domain>/operator/connection-invitations
```

Expected: no invitation attempt, OAuth state, Queue message or Lark write from
GET/HEAD smoke.

Generate invitations only after separate Connect-link approval. Read the operator token without printing it and send JSON over HTTPS:

```bash
curl --fail-with-body --request POST \
  --url https://<deployed-domain>/operator/connection-invitations \
  --header "Authorization: Bearer <OPERATOR_TOKEN_FROM_SECRET_STORE>" \
  --header "Content-Type: application/json" \
  --data '{"connectorKey":"google_ads","customerKey":"chemistry_k","maxAttempts":3}'
```

Repeat with `connectorKey` set to `youtube`. Do not paste the operator token into command history; the placeholder above is illustrative only.

## Rollback

Rollback the Worker to the recorded pre-rollout version:

```bash
npx wrangler rollback <PREVIOUS_VERSION_ID> --config wrangler.sync.jsonc --message "rollback customer OAuth rollout"
```

Migrations `0011` and `0012` are additive. Do not drop tables/columns or restore
over the existing Remote D1 automatically. Preserve invitation/state/credential
audit rows, disable public routing by Worker rollback, and use a separately
reviewed forward-fix or replacement-database restore from
`/tmp/social-mkt-state-dev-before-0012.sql` only with explicit approval.

After rollback, verify schedules remain false and Queue/Lark counters remain zero.
