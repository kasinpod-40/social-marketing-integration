# Google Ads Manager Script LIVE Path

## Authoritative decision — 2026-07-26

The primary Google Ads ingestion source for the MKT Integration Workspace is Google Ads
Manager Script, not direct Google Ads API.

```text
Google Ads
→ Manager Script
→ signed HMAC delivery
→ reference-only Queue
→ durable D1 Ads facts and Coverage
→ Shared RAW Ads Lark tables
→ Canonical Ads Lark tables
```

## API access relationship

Customer OAuth is complete and the encrypted refresh token is active. Direct Google Ads API
access currently reports `google_ads_api_access_pending`. That status is non-blocking for the
Manager Script path because Manager Script authorization and execution do not depend on the
Google Ads API Developer Token.

Direct API remains an optional future path and must not replace or silently compete with the
Manager Script source.

## Manager Script authorization contract

Manager Script LIVE requires all of the following:

```text
customer_key = chemistry_k
connector_key = google_ads
connection_status = connected
access_status ∈ {validated, google_ads_api_access_pending}
exact adwords scope present
active encrypted refresh-token reference matches
approved managerCustomerId matches runtime
approved advertiserCustomerId matches runtime
signed source identity matches runtime
HMAC key/signature valid
timestamp bounded
nonce reserved and non-replayed
six-dataset manifest complete
manual Connector/ingress/Queue/D1/Lark flags enabled
schedule disabled
```

API-derived external account, currency and timezone metadata is checked when present. Its
absence while API access is pending does not block Script LIVE because Manager/advertiser and
source timezone are bound by runtime identity and the signed payload. Conflicting metadata
remains a permanent rejection.

## Durable delivery contract

The Queue operation remains reference-only:

```json
{
  "schemaVersion": 1,
  "type": "google.ads.manager.signed-delivery.process",
  "operationId": "<runId>",
  "workKey": "google_ads:<runId>",
  "generation": 0,
  "originalRequestedAt": 0,
  "requestedAt": "<RFC3339>"
}
```

No token, signature, nonce, customer ID or source row enters the Queue body. The existing
D1-first Ads/Coverage writes, Lark destination preflight, stable keys, generation fence,
renewable lock, resumable phases, reconciliation, exact rerun and staged-payload redaction
remain authoritative.

## Current rollout state

```text
Manager Script PREVIEW       PASS / 6 datasets / 7 chunks / 1,375 rows
Customer OAuth               COMPLETE
Encrypted refresh token      ACTIVE
Direct API access            PENDING / NON-BLOCKING
LIVE gate hotfix             MERGED_PR_59
Hotfix merge commit          82767ffe80e417901e9b0a9f1f767ecefedb8c82
Final Branch Verification    PASS_RUN_490
Remote preflight             NOT RUN / OPERATOR ENV NOT CONNECTED
Migration 0015               NOT RUN
Workers deployment           NOT RUN
LIVE Queue/D1/Lark            NOT RUN
Schedule                     DISABLED
Production                   BLOCKED
```

The user has authorized one manual Integration Workspace LIVE UAT through Queue, D1 and Lark
plus exact rerun verification. Remote execution must still begin from a clean merged `main`
checkout in the protected operator environment with reviewed ignored Wrangler configs,
authenticated Cloudflare/Wrangler identity and an ignored evidence directory.

## Permanent boundary

- Do not wait for Developer Token approval before Manager Script rollout.
- Do not mark API access validated when it is pending.
- Do not bypass consent, scope, active credential, Manager/advertiser identity or signed-source
  checks.
- Do not enable the Google Ads schedule during manual UAT.
- Do not cut over Production without a separate customer-owned Production task.
