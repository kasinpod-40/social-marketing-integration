# Current Task — Google Ads Canonical Lark Mapping Hotfix

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
INCIDENT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
FIRST_DLQ_ID                        = terminal:a6ed54413000c25efd73ce7888cc2d10
SECOND_DLQ_ID                       = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
FIRST_FAILURE_FIELD                 = RAW_Ads_Daily.metric_date
SECOND_FAILURE_FIELD                = MKT_Ads_Accounts.ads_account_id
SECOND_FAILURE_REASON               = field does not exist in destination schema
TRANSPORT_CHUNKS                    = 7 / 7
TRANSPORT_ROWS                      = 1375 / 1375
D1_ADS_BUSINESS_ROWS                = 0
LARK_BUSINESS_WRITES                = 0
SCRIPT_MODE                         = DRY_RUN
SCRIPT_DELIVERY_ENABLED             = false
API_GOOGLE_ADS_FLAGS                = false
SYNC_GOOGLE_ADS_FLAGS               = false
DLQ_REDRIVE_ENABLED                 = false
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Incident progression

The first guarded LIVE run reached destination preflight and failed before any business write because
Google Ads date-only `metricDate` was sent to Lark DateTime fields without timezone resolution. PR
`#61` corrected Lark daily date serialization and guarded `failed_permanent` exact redrive.

The exact retained run was then redriven once. The second attempt passed the original `metric_date`
failure and stopped at the first Canonical Ads row:

```text
sync_run_id          = 115a17e8-2a25-4260-b921-5a5ae4e7f127
error_code           = LARK_PREFLIGHT_FAILED
table_id             = tbl3yPcXdQzZQvBc
logical_table        = MKT_Ads_Accounts
row                  = 0
field                = ads_account_id
reason               = field does not exist in destination schema
partial              = false
new terminal DLQ     = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
```

The first DLQ is `redriven`; the second DLQ remains `open`. No further redrive is authorized until this
hotfix passes review, merge, guarded deployment and a full live-schema preflight.

## Root cause

`buildGoogleAdsLarkWriteSet()` still emits multiple pre-migration Canonical Ads v1 aliases while the
live Lark Base has already completed the Canonical Ads v2 migration. The approved contract uses:

```text
MKT_Ads_Accounts   account_id, account_name, status
MKT_Ads_Campaigns  ads_campaign_key, account_id, external_campaign_id, status
MKT_Ads_AdGroups   ads_ad_group_key, account_id, external_campaign_id,
                   external_ad_group_id, status
MKT_Ads_Creatives  ads_creative_key, account_id, external_creative_id,
                   creative_name, status
MKT_Ads_Daily      account_id, entity_type, external_entity_id,
                   external_campaign_id, external_ad_group_id, external_ad_id,
                   external_creative_id, currency
```

The current adapter still emits aliases including `ads_account_id`, `ads_account_name`,
`campaign_key`, `campaign_id`, `campaign_status`, `ad_group_key`, `ad_group_id`,
`ad_group_status`, `creative_key`, `ad_name`, `ad_status` and Canonical Daily legacy ID names.

This is a source-contract drift between the runtime adapter and the already-applied Canonical Ads v2
schema. Lark Schema, Views and Formulas are not to be changed for this incident.

## Objective

Make the Google Ads Lark write set conform exactly to the approved and live Canonical Ads v2 field
contract in one bounded hotfix, including date/status/channel normalization, so the next controlled
redrive does not discover stale aliases one field at a time.

## In scope

1. Replace all stale Canonical Ads aliases in the Google Ads Lark adapter.
2. Populate only fields that exist in the approved Canonical Ads v2 core/extensions and are supported
   by the six-dataset signed delivery contract.
3. Preserve all existing stable-key values and D1 write contracts.
4. Map account/campaign/ad-group/ad/creative statuses to Canonical options:
   `active`, `paused`, `removed`, `unknown`.
5. Map Google advertising channels deterministically to approved options, including Search, Display,
   Video/YouTube, Demand Gen, Performance Max, Shopping, App and the approved fallback.
6. Resolve campaign `start_date` and `end_date` to local-midnight epoch milliseconds in
   `run.sourceTimezone` when present.
7. Keep unsupported optional fields omitted rather than inventing values.
8. Add a contract-level forbidden-alias regression assertion covering all Canonical output rows.
9. Add focused value assertions for every Canonical table produced by the current six datasets.
10. Record sanitized incident and verification evidence in Current Task, Project Brain and CHANGELOG.

## Out of scope

- Lark field/table/view/formula mutation;
- Remote D1 mutation or manual state repair;
- Queue send or DLQ redrive;
- Worker deployment;
- Manager Script rerun;
- new Google Ads datasets, budget joins, Asset Group ingestion or conversion-action expansion;
- relation-link population;
- schedule activation;
- Production cutover;
- closing or deleting either forensic DLQ/alert record.

## Canonical output contract

### Accounts

```text
ads_account_key
platform
account_id
account_name
currency
timezone
status
manager_account_id
is_test_account
account_link_status
resource_owner
```

Only fields supported by the signed account row/runtime identity are emitted. DEV ownership is
`developer_dev`; account link status is `selectable` because the signed LIVE path has already passed
exact Manager/advertiser selection and connection gates.

### Campaigns

```text
ads_campaign_key
platform
ad_channel
account_id
external_campaign_id
campaign_name
objective
status
channel_subtype
start_date
end_date
bidding_strategy_type
```

`start_date`/`end_date` remain date-only in source payload and stable identities but are epoch
milliseconds at source-timezone local midnight for Lark DateTime fields.

### Ad groups

```text
ads_ad_group_key
platform
ad_channel
account_id
external_campaign_id
external_ad_group_id
ad_group_name
status
ad_group_type
```

### Ads

```text
ads_ad_key
platform
ad_channel
account_id
external_campaign_id
external_ad_group_id
external_ad_id
external_creative_id
ad_name
status
ad_type
final_url
```

### Creatives

```text
ads_creative_key
platform
account_id
external_creative_id
creative_name
creative_type
status
source_content_id
```

### Daily

```text
ads_daily_key
metric_date
platform
ad_channel
account_id
entity_type
external_entity_id
external_campaign_id
external_ad_group_id
external_ad_id
external_creative_id
currency
spend_micros
impressions
reach
clicks
conversions
conversion_value_micros
video_views
video_view_rate
average_cpv_micros
```

No derived Formula field is written by the connector.

## Forbidden Canonical aliases

The generated Canonical write set must contain none of these exact keys:

```text
ads_account_id
ads_account_name
connection_status
campaign_key
campaign_id
campaign_status
ad_group_key
ad_group_id
ad_group_status
creative_key
ad_status
last_sync_at
```

`campaign_id` and `ad_group_id` remain valid only inside source payloads/RAW mappings, not Canonical
rows.

## Acceptance criteria

- The reproduced second incident no longer emits `ads_account_id` in `MKT_Ads_Accounts`.
- Every emitted Canonical key is in the approved per-table allowlist.
- Every required identity field is present and remains Text.
- Stable key values remain unchanged from the signed run.
- Account/campaign/ad-group/ad/creative status `ENABLED` maps to `active`.
- Campaign date-only values resolve using the signed source timezone without UTC day shift.
- Canonical Daily contains `entity_type`, `external_entity_id`, `account_id`, `currency` and exact
  external parent IDs.
- No Lark or D1 business write occurs during implementation.
- Focused Google Ads tests pass.
- `npm run check`, `npm test`, `npm run test:report-reliability`,
  `npm audit --audit-level=high` and `npm run deploy:dry-run` pass.

## Required focused tests

```text
tests/application/google-ads-live-run.test.js
tests/application/process-google-ads-manager-signed-delivery.test.js
tests/application/process-google-ads-manager-signed-delivery-runtime.test.js
tests/worker-runtime/google-ads-live-worker.test.js
```

## Implementation result

```text
STATUS          = IN_PROGRESS
BRANCH          = work/google-ads-canonical-lark-mapping-hotfix
FILES_CHANGED   = pending
COMMANDS_RUN    = pending CI
FOCUSED_TESTS   = pending CI
FULL_GATES      = pending CI
REMOTE_ACTIONS  = none
REMAINING_RISK  = second DLQ redrive blocked until review, merge, guarded deployment and preflight
```

## Runtime hold boundary

```text
Google Ads Script          DRY_RUN / delivery=false
API Google Ads flags       false
Sync Google Ads flags      false
DLQ redrive                false
Google Ads schedules       false
First DLQ                  redriven / retain
Second DLQ                 open / retain
Exact redrive              prohibited
Production                 blocked
```
