# Current Task — Google Ads Lark Key-Field Contract Hotfix

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
INCIDENT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
FIRST_DLQ_ID                        = terminal:a6ed54413000c25efd73ce7888cc2d10
FIRST_DLQ_STATUS                    = redriven
SECOND_DLQ_ID                       = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
SECOND_DLQ_STATUS                   = redriven
THIRD_DLQ_ID                        = PENDING_READ_ONLY_VERIFICATION
THIRD_SYNC_RUN_ID                   = 9ab3cacb-c491-4991-b755-d4224e70ff33
THIRD_FAILURE_CODE                  = UNHANDLED_SYNC_ERROR
THIRD_FAILURE_MESSAGE               = TableSyncEngine requires campaign_key
TRANSPORT_CHUNKS                    = 7 / 7
TRANSPORT_ROWS                      = 1375 / 1375
D1_ADS_BUSINESS_ROWS                = 0
LARK_BUSINESS_WRITES                = 0
SCRIPT_MODE                         = DRY_RUN
SCRIPT_DELIVERY_ENABLED             = false
API_GOOGLE_ADS_FLAGS                = false
SAFE_SYNC_FLAGS_REQUIRED            = true
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Incident progression

The original signed LIVE run has been retained and redriven through two reviewed hotfixes without
rerunning Manager Script:

1. PR `#61` fixed Lark DateTime serialization and guarded `failed_permanent` redrive.
2. PR `#62` aligned Canonical output rows with the live Canonical Ads v2 field names.
3. The third processing attempt passed both previous failures but stopped in destination preflight
   before any D1 or Lark business write:

```text
sync_run_id          = 9ab3cacb-c491-4991-b755-d4224e70ff33
admission_status     = failed_permanent
last_error_code      = GOOGLE_ADS_PROCESSING_FAILED
sync_error_code      = UNHANDLED_SYNC_ERROR
sync_error_message   = TableSyncEngine requires campaign_key
send_attempts        = 3
ads_entity_rows      = 0
ads_daily_rows       = 0
partial              = false
```

## Confirmed root cause

The Canonical row adapter now emits the reviewed v2 stable-key fields, but the processor's private
`LARK_TABLES` routing contract still contains three pre-migration key-field aliases:

```text
canonical.campaigns  current=campaign_key   required=ads_campaign_key
canonical.adGroups   current=ad_group_key   required=ads_ad_group_key
canonical.creatives  current=creative_key   required=ads_creative_key
```

The other five destination key fields are already correct:

```text
raw.entities         raw_ads_entity_key
raw.daily            raw_ads_daily_key
canonical.accounts   ads_account_key
canonical.ads        ads_ad_key
canonical.daily      ads_daily_key
```

`TableSyncEngine.planByKey()` validates that every row contains the configured key field. The stale
Campaign contract therefore fails before the preflight phase can be saved and before D1 writes begin.
This is a source routing-contract defect, not a Lark Schema or D1 defect.

## Objective

Align every Google Ads destination routing key with the row contract produced by
`buildGoogleAdsLarkWriteSet()` and add a processor-level regression test that would have rejected all
three stale aliases before runtime.

## In scope

1. Change only these processor contracts:
   - `campaign_key` → `ads_campaign_key`;
   - `ad_group_key` → `ads_ad_group_key`;
   - `creative_key` → `ads_creative_key`.
2. Preserve table order, destination table bindings, row payloads, stable-key values, D1 contracts,
   phases, continuations, reconciliation and retry semantics.
3. Record every `planByKey()` invocation in the durable processor test.
4. Assert the exact eight-table `(tableId, keyField)` sequence during preflight.
5. Assert each configured key field exists and is non-empty in every planned row.
6. Confirm the exact same routing contract is reused by one-table-per-continuation Lark execution.
7. Update Current Task, Project Brain and CHANGELOG with sanitized third-attempt evidence.

## Out of scope

- Remote D1 mutation or manual status repair;
- Queue send or DLQ redrive;
- Worker deployment;
- Lark Schema/View/Formula mutation;
- Manager Script rerun;
- changing Canonical row field names or stable-key values again;
- schedule activation;
- Production cutover;
- deleting or closing forensic DLQ, Sync Run or Alert evidence.

## Acceptance criteria

```text
Campaign routing key      ads_campaign_key
Ad Group routing key      ads_ad_group_key
Creative routing key      ads_creative_key
all 8 preflight rows      contain configured non-empty key
preflight plan sequence   exact and stable
Lark execution routing    same exact key contract
D1 contracts              unchanged
Canonical row payloads    unchanged
stable-key values         unchanged
TikTok/Core regression    PASS
Remote actions            none
```

Required gates:

```text
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Implementation result

```text
STATUS          = IN_PROGRESS
BRANCH          = work/google-ads-lark-keyfield-contract-hotfix
FILES_CHANGED   = pending
COMMANDS_RUN    = pending CI
FOCUSED_TESTS   = pending CI
FULL_GATES      = pending CI
REMOTE_ACTIONS  = none
REMAINING_RISK  = third exact redrive blocked until safe close, review, merge and guarded deployment
```

## Runtime hold boundary

```text
Google Ads Script          DRY_RUN / delivery=false
API signed ingress         false
Google Ads schedule        false
Recovery Worker flags      MUST be restored to false immediately
First DLQ                  redriven / retain / never redrive again
Second DLQ                 redriven / retain / never redrive again
Third DLQ                  retain / exact ID pending read-only verification
Next exact redrive         prohibited
Production                 blocked
```
