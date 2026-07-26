# Current Task — Google Ads Lark Key-Field Contract Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTED_PR_63_BRANCH_VERIFICATION_PASS_AWAITING_REVIEW
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

The Canonical row adapter emits the reviewed v2 stable-key fields, but the processor's private
`LARK_TABLES` routing contract retained three pre-migration key-field aliases:

```text
canonical.campaigns  previous=campaign_key   corrected=ads_campaign_key
canonical.adGroups   previous=ad_group_key   corrected=ads_ad_group_key
canonical.creatives  previous=creative_key   corrected=ads_creative_key
```

The other five destination key fields were already correct:

```text
raw.entities         raw_ads_entity_key
raw.daily            raw_ads_daily_key
canonical.accounts   ads_account_key
canonical.ads        ads_ad_key
canonical.daily      ads_daily_key
```

`TableSyncEngine.planByKey()` validates that every row contains the configured key field. The stale
Campaign contract failed before the preflight phase could be saved and before D1 writes began. This
was a source routing-contract defect, not a Lark Schema or D1 defect.

## Implemented correction

PR `#63` changes only the three stale routing keys and processor-level regression coverage:

1. `campaign_key` → `ads_campaign_key`;
2. `ad_group_key` → `ads_ad_group_key`;
3. `creative_key` → `ads_creative_key`;
4. every `planByKey()` call now has test evidence that all rows contain the configured non-empty key;
5. destination preflight must use the exact eight-table `(tableId, keyField)` sequence;
6. one-table-per-continuation Lark execution must reuse the identical sequence.

Table order, table bindings, Canonical row payloads, D1 contracts, stable-key values, phases,
continuations, reconciliation and retry semantics remain unchanged.

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

## Acceptance result

```text
Campaign routing key      ads_campaign_key                         PASS
Ad Group routing key      ads_ad_group_key                         PASS
Creative routing key      ads_creative_key                         PASS
all 8 preflight rows      contain configured non-empty key         PASS
preflight plan sequence   exact and stable                         PASS
Lark execution routing    same exact key contract                  PASS
D1 contracts              unchanged                               PASS
Canonical row payloads    unchanged                               PASS
stable-key values         unchanged                               PASS
TikTok/Core regression    PASS
Remote actions            none
```

## Verification result

```text
BRANCH                   = work/google-ads-lark-keyfield-contract-hotfix
PR                       = #63 / DRAFT
REVIEWED_SOURCE_HEAD     = a4549d5fffa0bdcb8050f8a7db840e0fb9c18df8
BRANCH_VERIFICATION      = PASS / RUN_510
FOCUSED_TIKTOK_TESTS     = 4 / 4 PASS
NODE_UNIT_INTEGRATION    = 825 / 825 PASS
WORKERS_RUNTIME_TESTS    = 9 / 9 PASS
REPORT_RELIABILITY       = 70 / 70 PASS
DEPENDENCY_AUDIT         = 0 vulnerabilities
WRANGLER_DRY_RUN         = PASS
FILES_CHANGED            = 5 after documentation closeout
REMOTE_ACTIONS_IN_PR     = none
```

## Remaining controlled rollout

Before any later exact redrive:

1. restore the currently deployed recovery Worker to `wrangler.sync.jsonc` safe flags;
2. verify all Google Ads execution and DLQ-redrive flags are false;
3. read the newest open Google Ads terminal DLQ ID from Remote D1;
4. review and merge PR `#63`;
5. deploy the merged Sync Worker through a new bounded recovery window;
6. redrive only the newly verified third DLQ once;
7. verify destination preflight, D1, Lark and reconciliation;
8. restore safe flags immediately.

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
