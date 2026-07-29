# TikTok Ads Customer Connect — readiness and final operator

## Repository-ready state

The repository provides a TikTok Ads customer authorization path by extending the existing Customer Connection foundation. It reuses signed retry-safe invitations, one-time OAuth state, encrypted credential storage, D1 authority, redacted outcomes and the existing HTTP boundary.

No Queue message, Lark write, Business data sync, Cron activation or Production action occurs during connection.

## Customer inputs still required

The customer must finish TikTok for Business / Business Center registration and provide or approve:

- TikTok Ads advertiser ID;
- access for the TikTok for Business app to that advertiser;
- app authorization under an administrator who may grant advertiser access.

The operator must configure these values locally or as Worker configuration without committing secrets:

```env
TIKTOK_ADS_APP_ID=...
TIKTOK_ADS_APP_SECRET=...
MKT_TIKTOK_ADS_ADVERTISER_ID=...
MKT_TIKTOK_ADS_REDIRECT_URI=https://<worker-host>/oauth/tiktok-ads/callback
```

Shared Customer Connection secrets and configuration must already be present.

## Safe plan

```bash
node scripts/tiktok-ads-customer-connect-readiness.mjs
```

This prints readiness only and performs no remote mutation.

## Final invitation creation

After the Worker has been separately reviewed and deployed with all Business and Schedule flags false:

```bash
node scripts/tiktok-ads-customer-connect-readiness.mjs --execute
```

The command creates one retry-safe invitation with a seven-day TTL and three explicit OAuth starts. It does not call TikTok, enqueue work or write Lark. Send only the returned `connectUrl` to the customer through a private channel.

## Customer browser flow

1. Open the invitation URL. GET is preview-only and consumes no attempt.
2. Confirm connection with POST.
3. Sign in to TikTok for Business and authorize the exact advertiser.
4. Callback exchanges the authorization code server-side.
5. The exact advertiser ID is checked both against the authorization response and the read-only advertiser-info endpoint.
6. The provider token is encrypted with the shared AES-256-GCM repository and never returned to the browser, Queue, Lark or logs.

## Acceptance

A successful callback must show:

```text
connector          tiktok_ads
connectionStatus   connected
accessStatus       validated
queued              false
larkWrite           false
```

The masked advertiser ID must end with the expected final four digits. A mismatch fails closed and requires corrected advertiser access or a new bounded attempt.

## Safety boundary

This runbook does not authorize Worker deployment, Remote D1 migration, Queue send, Lark mutation, schedule activation, TikTok reporting sync or Production cutover. Those are separate reviewed operations.
