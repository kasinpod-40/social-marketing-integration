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
`failed_permanent` redrive path. The original DLQ was redriven exactly once without rerunning
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
```

PR `#62` aligned Canonical output rows with the already-applied Ads v2 schema and preserved the
D1 and stable-key contracts. The second DLQ was then redriven exactly once.

### Failure 3 — Processor key-field routing drift

The third attempt passed both prior defects and failed before the destination preflight phase
could be saved:

```text
sync_run_id                9ab3cacb-c491-4991-b755-d4224e70ff33
admission_status           failed_permanent
admission_error            GOOGLE_ADS_PROCESSING_FAILED
sync_error                 UNHANDLED_SYNC_ERROR
message                    TableSyncEngine requires campaign_key
send_attempts              3
ads_entity_state rows      0
ads_daily_facts rows       0
partial                    false
third DLQ                  pending read-only verification
```

The Canonical rows already emitted `ads_campaign_key`, `ads_ad_group_key` and
`ads_creative_key`, but the processor's private destination routing table still configured
`campaign_key`, `ad_group_key` and `creative_key`. `TableSyncEngine.planByKey()` therefore failed
closed before D1 or Lark writes. This is not a Lark Schema or D1 defect.

## Merged Canonical Ads v2 correction

```text
pull request               #62 / MERGED
merge commit               3ab7a249cb40f6e3f377cecf02f2d8713bbdcb61
reviewed source head       56d27b6c98b7b915e4367a2b5781f110cbc10f45
source verification        PASS / RUN_505
final docs verification    PASS / RUN_509
```

The merged hotfix:

1. replaces stale aliases across Accounts, Campaigns, Ad Groups, Ads, Creatives and Daily;
2. preserves all D1 contracts and stable-key values;
3. retains Canonical Campaign `objective` when supplied by the signed source;
4. omits generic ownership metadata that is not grounded in signed source/runtime identity;
5. normalizes Google source statuses to `active`, `paused`, `removed` or `unknown`;
6. maps Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App and fallback
   channels to reviewed Canonical options;
7. derives Canonical Daily channel from Campaign source enums when signed v1 transport carries
   its legacy `google_other` fallback;
8. resolves Campaign date-only fields to source-timezone local-midnight epoch values for Lark;
9. maps Google video assets to Canonical Creative identity fields;
10. converts average CPV micros to the Canonical display-unit `average_cpv` field;
11. enforces exact per-table output allowlists and forbidden-alias tests.

No Lark Schema/View/Formula change is authorized for these incidents. The applied Canonical Ads v2
schema remains authoritative.

## Merged key-field routing correction

```text
pull request               #63 / MERGED
merge commit               23a40b9f1c1e85838d9648a32deb2db2944b2604
reviewed source head       a4549d5fffa0bdcb8050f8a7db840e0fb9c18df8
final branch head          e877d217970bffa6ee65bafb13538a80649f6825
source verification        PASS / RUN_510
final docs verification    PASS / RUN_513
```

The merged correction:

1. changes Campaign routing to `ads_campaign_key`;
2. changes Ad Group routing to `ads_ad_group_key`;
3. changes Creative routing to `ads_creative_key`;
4. preserves the remaining five correct routing keys;
5. validates every planned row contains its configured non-empty key;
6. asserts the exact eight-table preflight routing sequence;
7. asserts one-table-per-continuation Lark writes reuse the identical sequence;
8. does not change row payloads, D1 contracts, stable-key values, table order, phases,
   continuations or reconciliation.

## Verification evidence

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
Manager Script execution, schedule or Production action occurred in PR `#63` implementation.

## Recovery boundary

Before another redrive:

1. restore the currently deployed recovery Worker to the safe `wrangler.sync.jsonc` configuration;
2. verify Google Ads Connector, Queue admission, D1/Lark writes and DLQ redrive are all false;
3. retrieve the newest open Google Ads terminal DLQ ID from Remote D1;
4. pull clean merged `main` containing `23a40b9f1c1e85838d9648a32deb2db2944b2604`;
5. deploy the merged Worker through a new bounded recovery window;
6. redrive only the newly verified third DLQ once;
7. verify destination preflight, D1, Lark and final reconciliation;
8. restore safe flags immediately.

## Runtime hold state

```text
Manager Script              DRY_RUN / delivery=false
API signed ingress          false
Google Ads schedules        false
Recovery Worker flags       must be restored to false
first DLQ                   redriven / retained / never redrive again
second DLQ                  redriven / retained / never redrive again
third DLQ                   retain / exact ID pending read-only verification
next exact redrive          prohibited
Production                  blocked
```

## Permanent boundary

- Do not wait for Developer Token approval before Manager Script rollout.
- Do not mark API access validated when it is pending.
- Do not bypass consent, scope, active credential, Manager/advertiser identity or signed-source
  checks.
- Do not alter Lark fields to accommodate stale connector contracts.
- Do not write ownership classifications that are not grounded in customer profile/runtime data.
- Do not rewrite D1 date-only facts or stable keys with epoch values.
- Do not rerun Google Ads Manager Script to recover the retained staged incident.
- Do not redrive the first or second DLQ again; both are already `redriven`.
- Do not infer the third DLQ ID from prior message IDs; read it from Remote D1.
- Do not enable the Google Ads schedule during manual UAT.
- Do not cut over Production without a separate customer-owned Production task.
