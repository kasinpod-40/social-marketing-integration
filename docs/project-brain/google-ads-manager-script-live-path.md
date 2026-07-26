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

No token, signature, nonce, customer ID or source row enters the Queue body. D1-first
Ads/Coverage writes, Lark destination preflight, stable keys, generation fence, renewable lock,
resumable phases, reconciliation, exact rerun and staged-payload redaction remain authoritative.

## First guarded LIVE incident

The first guarded manual LIVE delivery reached signed transport and Queue processing with all
expected data:

```text
run_id                     88351cb4-714d-49ef-91db-d95550a93ebf
chunks                     7 / 7
rows                       1,375 / 1,375
transport_status           assembling
admission_status           failed_permanent
work_lifecycle_status      active
error_code                 LARK_PREFLIGHT_FAILED
D1 Ads business rows       0
Lark business writes       0
```

The failure happened in destination preflight because `metric_date` was passed to a Lark DateTime
field as `YYYY-MM-DD`. The shared DateTime serializer correctly failed closed before any D1 or Lark
business write.

A second defect prevented exact recovery: permanent failure records terminal `completed_at`
evidence, while the redrive SQL declared `failed_permanent` eligible but required
`completed_at IS NULL`.

## Active hotfix contract

Branch:

```text
work/google-ads-live-lark-date-redrive-hotfix
```

The hotfix must:

1. resolve source date-only `metricDate` to local midnight in the signed `sourceTimezone` for Lark
   DateTime fields only;
2. preserve D1 date-only facts, stable keys, Coverage identities and source payload JSON;
3. allow exact same-generation redrive from `failed_permanent` by clearing admission terminal
   `completed_at` only after confirming complete unredacted staged payloads;
4. continue to reject completed/superseded Work, identity drift, active locks, redacted payloads and
   incomplete staged runs;
5. reuse the retained DLQ reference and never require a new Manager Script LIVE run.

## Runtime hold state

```text
Manager Script              DRY_RUN / delivery=false
API Google Ads flags        false
Sync Google Ads flags       false
Google Ads schedules        false
Incident DLQ                open / retained
Exact redrive               blocked pending hotfix review and merge
Production                  blocked
```

No Remote D1 mutation, Queue send, Lark write, Worker deployment, schedule or Production action is
part of the source implementation branch.

## Permanent boundary

- Do not wait for Developer Token approval before Manager Script rollout.
- Do not mark API access validated when it is pending.
- Do not bypass consent, scope, active credential, Manager/advertiser identity or signed-source
  checks.
- Do not alter Lark DateTime fields to Text to accommodate connector output.
- Do not rewrite D1 date-only facts or stable keys with epoch values.
- Do not rerun Google Ads Manager Script to recover the retained staged incident.
- Do not enable the Google Ads schedule during manual UAT.
- Do not cut over Production without a separate customer-owned Production task.
