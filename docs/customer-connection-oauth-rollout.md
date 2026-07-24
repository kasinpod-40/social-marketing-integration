# Customer Connection OAuth — Guarded Rollout

## Current authority

```text
REMOTE_D1_MIGRATION             = COMPLETE
WORKER_DEPLOYMENT               = COMPLETE
GOOGLE_REDIRECT_URI_LIVE_CHANGE = COMPLETE
CONNECT_LINK_GENERATION         = ALL_4_CONSUMED_NO_CALLBACK
CUSTOMER_OAUTH                  = AUTHORIZATION_PENDING_STATES_EXPIRED
SCHEDULES                       = DISABLED
QUEUE_MESSAGES                  = 0
LARK_WRITES                     = 0
```

Remote D1 migration, Worker deployment and Google Redirect URI changes were completed on `2026-07-24`. Both the first customer pair and the separately approved 15-minute test pair were consumed at OAuth begin without callback completion. All four OAuth states expired; no Refresh Token or identity selection exists. Signed URLs are not stored here and all prior links are unusable. Do not rerun migration/deployment or generate further links against the current one-shot-on-GET behavior. Implement and verify a retry-safe, preview-safe confirmation boundary first. Use the real uncommitted `wrangler.sync.jsonc`; never substitute the example file for remote commands.

## Routes

```text
POST /operator/connection-invitations
GET  /connect/google-ads
GET  /oauth/google-ads/callback
GET  /connect/youtube
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

## Guarded sequence after approval

Record the current Worker version, then export Remote D1 before migration:

```bash
npx wrangler versions list --config wrangler.sync.jsonc
npx wrangler d1 export social-mkt-state-dev --remote --config wrangler.sync.jsonc --output /tmp/social-mkt-state-dev-before-0011.sql
shasum -a 256 /tmp/social-mkt-state-dev-before-0011.sql
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

Smoke without customer credentials:

```bash
curl -i https://<deployed-domain>/unknown
curl -i https://<deployed-domain>/operator/connection-invitations
```

Expected: unknown route `404`; unsupported operator method `405`; no Queue message and no Lark write.

Generate invitations only after separate Connect-link approval. Read the operator token without printing it and send JSON over HTTPS:

```bash
curl --fail-with-body --request POST \
  --url https://<deployed-domain>/operator/connection-invitations \
  --header "Authorization: Bearer <OPERATOR_TOKEN_FROM_SECRET_STORE>" \
  --header "Content-Type: application/json" \
  --data '{"connectorKey":"google_ads","customerKey":"chemistry_k"}'
```

Repeat with `connectorKey` set to `youtube`. Do not paste the operator token into command history; the placeholder above is illustrative only.

## Rollback

Rollback the Worker to the recorded pre-rollout version:

```bash
npx wrangler rollback <PREVIOUS_VERSION_ID> --config wrangler.sync.jsonc --message "rollback customer OAuth rollout"
```

Migration `0011` is additive. Do not drop tables/columns or restore over the existing Remote D1 automatically. Preserve invitation/state/credential audit rows, disable public routing by Worker rollback, and use a separately reviewed forward-fix or replacement-database restore from `/tmp/social-mkt-state-dev-before-0011.sql` only with explicit approval.

After rollback, verify schedules remain false and Queue/Lark counters remain zero.
