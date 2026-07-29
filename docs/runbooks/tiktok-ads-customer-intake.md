# TikTok Ads Customer Connect — customer intake

Use this checklist before provisioning any secret, deploying a Worker version or creating a customer invitation.

## Required customer facts

```text
customer_key                  chemistry_k
customer_legal_or_brand_name  ______________________________
tiktok_business_center_id     ______________________________
tiktok_advertiser_id          ______________________________
advertiser_display_name       ______________________________
advertiser_timezone           ______________________________
advertiser_currency           ______________________________
authorizing_admin_name        ______________________________
authorizing_admin_email       ______________________________
app_approval_status           ______________________________
callback_domain_approved      yes / no
```

The advertiser ID is the only customer-supplied identity that becomes an exact runtime gate. Display name, Business Center ID, timezone and currency are verification metadata until TikTok returns them from the read-only advertiser-info endpoint.

## Customer-side prerequisites

- TikTok for Business account exists.
- Business Center exists and the authorizing user is an administrator.
- The target Ads Manager advertiser is active and visible to that administrator.
- The TikTok for Business app is approved for the required read-only/reporting access.
- The app is allowed to request access to the exact advertiser.
- The callback URL registered in TikTok exactly matches the Worker callback URL.

## Operator-side prerequisites

The following values must be supplied through local environment variables or Worker Secrets and never committed:

```env
TIKTOK_ADS_APP_ID=...
TIKTOK_ADS_APP_SECRET=...
MKT_TIKTOK_ADS_ADVERTISER_ID=...
MKT_TIKTOK_ADS_REDIRECT_URI=https://<worker-host>/oauth/tiktok-ads/callback
MKT_CONNECTION_OPERATOR_TOKEN=...
```

Shared Customer Connection signing and encryption secrets must already be available.

## Pre-invitation verification

- Confirm `MKT_ENV=development`.
- Confirm `MKT_CUSTOMER_PROFILE=integration_workspace`.
- Confirm `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`.
- Confirm all Business, Queue and Schedule activation flags remain false.
- Run the readiness command without `--execute` and verify `missingInputs` is empty.
- Verify the redirect URI uses HTTPS and exactly matches the TikTok app configuration.
- Verify the advertiser ID contains digits only and matches the customer-supplied Ads Manager advertiser.

## Customer authorization evidence

Record these after the customer completes the browser flow:

```text
connection_id                 ______________________________
callback_completed_at         ______________________________
masked_advertiser_id          ______________________________
validated_advertiser_name     ______________________________
validated_timezone            ______________________________
validated_currency            ______________________________
connection_status             connected
access_status                 validated
queued                        false
lark_write                    false
```

Never record the access token, app secret, authorization code, signed OAuth state or complete invitation URL in tickets, chat, Lark or operational logs.

## Stop conditions

Stop and do not retry blindly when any of these occur:

- advertiser identity mismatch;
- customer administrator cannot see the target advertiser;
- callback URL differs from the registered TikTok URL;
- app approval or advertiser permission is missing;
- invitation attempts are exhausted;
- callback state is expired or replayed;
- any secret appears in browser output, logs or persisted metadata.
