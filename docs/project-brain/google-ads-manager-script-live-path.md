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

## Guarded LIVE incident progression

The first guarded manual LIVE delivery reached signed transport and Queue processing with all
expected data:

```text
run_id                     88351cb4-714d-49ef-91db-d95550a93ebf
chunks                     7 / 7
rows                       1,375 / 1,375
transport_status           assembling
admission_status           failed_permanent
work_lifecycle_status      active
D1 Ads business rows       0
Lark business writes       0
```

### Failure 1 — Shared RAW daily date serialization

```text
logical destination        RAW_Ads_Daily
field                      metric_date
error                      date-only value lacked an explicit timezone
DLQ                        terminal:a6ed54413000c25efd73ce7888cc2d10
```

PR `#61` corrected Lark daily date serialization and the guarded same-generation
`failed_permanent` redrive path. The original DLQ was then redriven exactly once without rerunning
Manager Script.

### Failure 2 — Canonical field alias drift

The second attempt passed the original date failure and stopped in destination preflight before
any business write:

```text
sync_run_id                115a17e8-2a25-4260-b921-5a5ae4e7f127
logical destination        MKT_Ads_Accounts
field                      ads_account_id
error                      field does not exist in destination schema
partial                    false
second DLQ                 terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
second DLQ status          open
```

This proved the date hotfix worked and exposed a separate adapter/schema drift: the live Lark Base
already uses Canonical Ads v2 while the runtime adapter still emitted several pre-migration aliases.
The second failure also remained non-partial with zero D1 Ads business rows and zero Lark writes.

## Canonical Ads v2 hotfix contract

Branch and PR:

```text
branch                     work/google-ads-canonical-lark-mapping-hotfix
pull request               #62
reviewed source head       4f8dff480621b0e033495e694fd38f9df7e23c7e
branch verification        PASS / RUN_499
```

The hotfix:

1. replaces stale aliases across Accounts, Campaigns, Ad Groups, Ads, Creatives and Daily;
2. preserves all D1 contracts and stable-key values;
3. normalizes Google source statuses to `active`, `paused`, `removed` or `unknown`;
4. maps Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App and fallback
   channels to reviewed Canonical options;
5. derives Canonical Daily channel from Campaign source enums when signed v1 transport carries
   its legacy `google_other` fallback;
6. resolves Campaign date-only fields to source-timezone local-midnight epoch values for Lark;
7. maps Google video assets to Canonical Creative identity fields;
8. converts average CPV micros to the Canonical display-unit `average_cpv` field;
9. enforces exact per-table output allowlists and forbidden-alias tests.

No Lark Schema/View/Formula change is authorized for this incident. The already-applied Canonical
Ads v2 schema remains authoritative.

## Verification evidence

Branch Verification run `#499` passed:

```text
syntax / architecture / hygiene    PASS
focused TikTok regression          4 / 4 PASS
Node Unit / Integration            825 / 825 PASS
Workers runtime                    9 / 9 PASS
report reliability                 70 / 70 PASS
dependency audit                   0 vulnerabilities
Wrangler deployment dry-run        PASS
```

No Remote D1 mutation, Queue send, DLQ redrive, Lark mutation/write, Worker deployment,
Manager Script execution, schedule or Production action occurred in PR `#62` implementation.

## Runtime hold state

```text
Manager Script              DRY_RUN / delivery=false
API Google Ads flags        false
Sync Google Ads flags       false
DLQ redrive                 false
Google Ads schedules        false
first DLQ                   redriven / retained
second DLQ                  open / retained
next exact redrive          blocked pending review, merge and guarded deployment
Production                  blocked
```

## Permanent boundary

- Do not wait for Developer Token approval before Manager Script rollout.
- Do not mark API access validated when it is pending.
- Do not bypass consent, scope, active credential, Manager/advertiser identity or signed-source
  checks.
- Do not alter Lark fields to accommodate stale connector aliases.
- Do not rewrite D1 date-only facts or stable keys with epoch values.
- Do not rerun Google Ads Manager Script to recover the retained staged incident.
- Do not redrive the first DLQ again; it is already `redriven`.
- Do not redrive the second DLQ before PR `#62` is reviewed, merged and deployed through the
  guarded Sync recovery configuration.
- Do not enable the Google Ads schedule during manual UAT.
- Do not cut over Production without a separate customer-owned Production task.
