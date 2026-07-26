# Google Ads Customer OAuth — Connected / API Access Pending

Date: 2026-07-26
Environment: Development Integration Workspace
Customer key: `chemistry_k`

## Sanitized result

```text
connector_key                  = google_ads
connection_status              = connected
access_status                  = google_ads_api_access_pending
active_encrypted_refresh_token = 1
invitation_completed           = 1
last_validated_at              = null
last_error_code                = GOOGLE_ADS_API_ACCESS_PENDING
```

## Interpretation

- Google OAuth consent and callback completed.
- A Refresh Token is present in the encrypted credential boundary.
- The one-time connection invitation completed.
- Exact Google Ads advertiser identity validation did not complete because the current Developer Token access level cannot yet query the approved production advertiser.
- No plaintext credential, OAuth code, state, invitation token, ciphertext, IV or credential reference is recorded here.
- This result does not authorize Queue admission, business writes, Lark writes, schedule activation or Production.

## Next external gate

Wait for a Google Ads API Developer Token access level that permits read-only calls against the approved production advertiser, then re-run the existing encrypted-credential validation gate. A new OAuth connection is not required unless the stored credential is revoked, expires under the provider lifecycle, or scope/account validation later fails.

## Unchanged safe state

```text
Remote migration 0015         = NOT_APPLIED_BY_THIS_EVIDENCE
Worker rollout                = NOT_AUTHORIZED
External LIVE run             = NOT_RUN
Queue message                 = NOT_SENT
D1 Ads business write         = NOT_RUN
Shared RAW / Canonical Lark   = NOT_RUN
Schedule                      = DISABLED
Production                    = BLOCKED
```
