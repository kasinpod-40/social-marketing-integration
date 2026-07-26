# Current Task — Google Ads Canonical Lark Mapping Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTED_PR_62_READY_FOR_REVIEW
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
INCIDENT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
FIRST_DLQ_ID                        = terminal:a6ed54413000c25efd73ce7888cc2d10
FIRST_DLQ_STATUS                    = redriven
SECOND_DLQ_ID                       = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
SECOND_DLQ_STATUS                   = open
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
`#61` corrected the date serialization and guarded same-generation `failed_permanent` redrive.

The original DLQ was then redriven exactly once. The second attempt passed the original
`metric_date` failure and stopped at the first Canonical Ads row:

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

This confirms PR `#61` worked and exposed an independent Canonical adapter/schema drift. Both
attempts remained non-partial: destination preflight stopped execution before any D1 Ads fact or
Lark business write.

## Root cause

The live Lark Base already uses the applied Canonical Ads v2 field contract. The Google Ads runtime
adapter still emitted several pre-migration aliases, including:

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

Lark Schema, Views and Formulas are not defective and are not changed by this hotfix.

## Implemented correction

PR `#62` updates only the Google Ads Lark adapter and focused tests:

1. Accounts now use `account_id`, `account_name`, `status` and reviewed Google extensions.
2. Campaigns use `ads_campaign_key`, `account_id`, `external_campaign_id`, Canonical status,
   reviewed channel values and source-timezone DateTime values.
3. Ad Groups use `ads_ad_group_key`, `external_campaign_id` and `external_ad_group_id`.
4. Ads use `ads_ad_key`, exact external parent IDs, `ad_type` and `final_url`.
5. YouTube assets use `ads_creative_key`, `external_creative_id`, `creative_name`,
   `creative_type`, `status` and `source_content_id`.
6. Daily rows use Canonical account/entity/external IDs, currency and approved metric fields.
7. Google source statuses map to `active`, `paused`, `removed` or `unknown`.
8. Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App and fallback channels map
   to reviewed Canonical options.
9. Canonical Daily derives modern channel from Campaign source enums when signed transport v1 uses
   legacy `google_other`.
10. Average CPV micros convert to the Canonical display-unit `average_cpv` field.
11. All D1 contracts, source payloads and stable-key values remain unchanged.
12. Exact per-table allowlists and forbidden-alias tests prevent stale names from returning.

## Out of scope

- Lark field/table/view/formula mutation;
- Remote D1 mutation or manual state repair;
- Queue send or DLQ redrive;
- Worker deployment;
- Manager Script rerun;
- new Google Ads datasets, budget joins, Asset Group ingestion or conversion-action expansion;
- schedule activation;
- Production cutover;
- deleting or closing either forensic DLQ/alert record.

## Acceptance result

```text
MKT_Ads_Accounts no longer emits ads_account_id             PASS
all Canonical rows obey exact per-table field allowlists    PASS
all forbidden pre-migration aliases are absent              PASS
stable-key values remain unchanged                          PASS
D1 date-only facts and write contracts remain unchanged     PASS
ENABLED status maps to active                               PASS
campaign dates use source-timezone local midnight           PASS
Daily account/entity/external IDs and currency are present  PASS
legacy google_other is normalized from Campaign source      PASS
no Remote D1/Lark/Queue/Worker action occurred              PASS
```

## Verification result

```text
BRANCH                   = work/google-ads-canonical-lark-mapping-hotfix
PR                       = #62 / DRAFT
REVIEWED_SOURCE_HEAD     = 4f8dff480621b0e033495e694fd38f9df7e23c7e
BRANCH_VERIFICATION      = PASS / RUN_499
FOCUSED_TIKTOK_TESTS     = 4 / 4 PASS
NODE_UNIT_INTEGRATION    = 825 / 825 PASS
WORKERS_RUNTIME_TESTS    = 9 / 9 PASS
REPORT_RELIABILITY       = 70 / 70 PASS
DEPENDENCY_AUDIT         = 0 vulnerabilities
WRANGLER_DRY_RUN         = PASS
REMOTE_ACTIONS           = none
```

Changed files:

```text
CHANGELOG.md
docs/current-task.md
docs/project-brain/google-ads-manager-script-live-path.md
packages/application/src/google-ads/google-ads-live-run.js
tests/application/google-ads-live-run.test.js
```

## Remaining controlled rollout

After Repository review and merge only:

1. deploy the merged Sync Worker through the guarded recovery configuration;
2. keep signed ingress and Google Ads schedule disabled;
3. enable Connector, Queue admission, D1/Lark writes and DLQ redrive only for the bounded window;
4. send one redrive command for the second DLQ only;
5. verify Queue → preflight → D1 → Lark → reconciliation for the original Run ID;
6. restore all Google Ads and DLQ-redrive flags to false immediately after verification.

## Runtime hold boundary

```text
Google Ads Script          DRY_RUN / delivery=false
API Google Ads flags       false
Sync Google Ads flags      false
DLQ redrive                false
Google Ads schedules       false
First DLQ                  redriven / retain / never redrive again
Second DLQ                 open / retain
Second exact redrive       prohibited until PR #62 review, merge and guarded deploy
Production                 blocked
```
